/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["OTRUI"];

const {Services} = ChromeUtils.import("resource:///modules/imServices.jsm");
const {
  XPCOMUtils,
  l10nHelper,
} = ChromeUtils.import("resource:///modules/imXPCOMUtils.jsm");

const {OTR}  = ChromeUtils.import("resource:///modules/OTR.jsm");

const privDialog = "chrome://chat/content/otr-generate-key.xul";
const authDialog = "chrome://chat/content/otr-auth.xul";
const addFingerDialog = "chrome://chat/content/otr-add-fingerprint.xul";

XPCOMUtils.defineLazyGetter(this, "_", () =>
  l10nHelper("chrome://chat/content/otrUI.properties")
);

const authVerify = "otr-auth-unverified";

var authLabelMap = new Map([
  ["otr:auth-error", _("auth.error")],
  ["otr:auth-success", _("auth.success")],
  ["otr:auth-successThem", _("auth.successThem")],
  ["otr:auth-fail", _("auth.fail")],
  ["otr:auth-waiting", _("auth.waiting")],
]);

var authTitleMap = new Map([
  ["otr:auth-error", "error"],
  ["otr:auth-success", "success"],
  ["otr:auth-successThem", "successThem"],
  ["otr:auth-fail", "fail"],
  ["otr:auth-waiting", "waiting"],
]);

var trustMap = new Map([
  [OTR.trustState.TRUST_NOT_PRIVATE, {
    startLabel: _("start.label"),
    authLabel: _("auth.label"),
    disableStart: false,
    disableEnd: true,
    disableAuth: true,
    class: "not_private",
  }],
  [OTR.trustState.TRUST_UNVERIFIED, {
    startLabel: _("refresh.label"),
    authLabel: _("auth.label"),
    disableStart: false,
    disableEnd: false,
    disableAuth: false,
    class: "unverified",
  }],
  [OTR.trustState.TRUST_PRIVATE, {
    startLabel: _("refresh.label"),
    authLabel: _("reauth.label"),
    disableStart: false,
    disableEnd: false,
    disableAuth: false,
    class: "private",
  }],
  [OTR.trustState.TRUST_FINISHED, {
    startLabel: _("start.label"),
    authLabel: _("auth.label"),
    disableStart: false,
    disableEnd: false,
    disableAuth: true,
    class: "finished",
  }],
]);

var windowRefs = new Map();

var OTRUI = {
  globalDoc: null,
  visibleConv: null,

  debug: true,
  logMsg(msg) {
    if (!OTRUI.debug)
      return;
    Services.console.logStringMessage(msg);
  },

  prefs: null,
  setPrefs() {
    let branch = "chat.otr.";
    let prefs = {
      requireEncryption: false,
      verifyNudge: true,
    };
    let defaults = Services.prefs.getDefaultBranch(branch);
    Object.keys(prefs).forEach(function(key) {
      defaults.setBoolPref(key, prefs[key]);
    });
    OTRUI.prefs = Services.prefs.getBranch(branch);
  },

  addMenuObserver() {
    let iter = Services.ww.getWindowEnumerator();
    while (iter.hasMoreElements())
      OTRUI.addMenus(iter.getNext());
    Services.obs.addObserver(OTRUI, "domwindowopened");
  },

  removeMenuObserver() {
    let iter = Services.ww.getWindowEnumerator();
    while (iter.hasMoreElements())
      OTRUI.removeMenus(iter.getNext());
    Services.obs.removeObserver(OTRUI, "domwindowopened");
  },

  addMenus(win) {
    let doc = win.document;
    // Account for unready windows
    if (doc.readyState !== "complete") {
      let listen = function() {
        win.removeEventListener("load", listen);
        OTRUI.addMenus(win);
      };
      win.addEventListener("load", listen);
    }
  },

  removeMenus(win) {
    let doc = win.document;
    OTRUI.removeBuddyContextMenu(doc);
  },

  addBuddyContextMenu(buddyContextMenu, doc) {
    if (!buddyContextMenu || !OTR.libLoaded) {
      return;  // Not the buddy list context menu
    }
    OTRUI.removeBuddyContextMenu(doc);

    let sep = doc.createElement("menuseparator");
    sep.setAttribute("id", "otrsep");
    let menuitem = doc.createElement("menuitem");
    menuitem.setAttribute("label", _("buddycontextmenu.label"));
    menuitem.setAttribute("id", "otrcont");
    menuitem.addEventListener("command", () => {
      let target = buddyContextMenu.triggerNode;
      if (target.localName == "richlistitem") {
        let contact = target.contact;
        let args = OTRUI.contactWrapper(contact);
        args.wrappedJSObject = args;
        let features = "chrome,modal,centerscreen,resizable=no,minimizable=no";
        Services.ww.openWindow(null, addFingerDialog, "", features, args);
      }
    });

    buddyContextMenu.addEventListener("popupshowing", (e) => {
      let target = e.target.triggerNode;
      if (target.localName == "richlistitem") {
        menuitem.hidden = false;
        sep.hidden = false;
      } else { /* probably imconv */
        menuitem.hidden = true;
        sep.hidden = true;
      }
    });

    buddyContextMenu.appendChild(sep);
    buddyContextMenu.appendChild(menuitem);
  },

  removeBuddyContextMenu(doc) {
    let s = doc.getElementById("otrsep");
    if (s) {
      s.remove();
    }
    let p = doc.getElementById("otrcont");
    if (p) {
      p.remove();
    }
  },

  init() {
    // console.log("====> OTRUI init\n");
    OTRUI.setPrefs();
    OTR.init({
      requireEncryption: OTRUI.prefs.getBoolPref("requireEncryption"),
      verifyNudge: OTRUI.prefs.getBoolPref("verifyNudge"),
    });
    if (!OTR.libLoaded) {
      return;
    }
    OTR.addObserver(OTRUI);
    OTR.loadFiles().then(function() {
      Services.obs.addObserver(OTR, "new-ui-conversation");
      // Disabled until #76 is resolved.
      // Services.obs.addObserver(OTRUI, "contact-added", false);
      Services.obs.addObserver(OTRUI, "account-added");
      // Services.obs.addObserver(OTRUI, "contact-signed-off", false);
      Services.obs.addObserver(OTRUI, "conversation-loaded");
      Services.obs.addObserver(OTRUI, "conversation-closed");
      Services.obs.addObserver(OTRUI, "prpl-quit");

      OTRUI.prefs.addObserver("", OTRUI);
      let conversations = Services.conversations.getConversations();
      while (conversations.hasMoreElements()) {
      let aConv = conversations.getNext();
      OTRUI.initConv(aConv);
      }
      OTRUI.addMenuObserver();
    }).catch(function(err) {
      // console.log("===> " + err + "\n");
      throw err;
    });
  },

  disconnect(aConv) {
    if (aConv)
      return OTR.disconnect(aConv, true);
    let allGood = true;
    let conversations = Services.conversations.getConversations();
    while (conversations.hasMoreElements()) {
      let conv = conversations.getNext();
      if (conv.isChat)
        continue;
      if (!OTR.disconnect(conv, true)) {
        allGood = false;
      }
    }
    return allGood;
  },

  changePref(aMsg) {
    switch (aMsg) {
    case "requireEncryption":
      OTR.setPolicy(OTRUI.prefs.getBoolPref("requireEncryption"));
      break;
    case "verifyNudge":
      OTR.verifyNudge = OTRUI.prefs.getBoolPref("verifyNudge");
      break;
    default:
      OTRUI.logMsg(aMsg);
    }
  },

  openAuth(window, name, mode, uiConv, contactInfo) {
    let otrAuth = this.globalDoc.querySelector(".otr-auth");
    otrAuth.disabled = true;
    let win = window.openDialog(
      authDialog,
      "auth=" + name,
      "centerscreen,resizable=no,minimizable=no",
      mode,
      uiConv,
      contactInfo
    );
    windowRefs.set(name, win);
    window.addEventListener("beforeunload", function() {
      otrAuth.disabled = false;
      windowRefs.delete(name);
    });
  },

  closeAuth(context) {
    let win = windowRefs.get(context.username);
    if (win)
      win.close();
  },

  noOtrPossible(otrContainer, context) {
    otrContainer.hidden = true;

    if (context) {
      OTRUI.hideUserNotifications(context);
    } else {
      OTRUI.hideAllNotifications();
    }
  },

  sendSystemAlert(uiConv, conv, bundleId) {
    uiConv.systemMessage(_(bundleId, conv.normalizedName));
  },

  setNotificationBox(notificationbox) {
    this.globalBox = notificationbox;
  },

/*
 *  possible states:
 *    tab isn't a 1:1, isChat == true
 *      then OTR isn't possible, hide the button
 *    tab is a 1:1, isChat == false
 *      no conversation active, uiConv cannot be found
 *        then OTR isn't possible YET, hide the button
 *      conversation active, uiConv found
 *        disconnected?
 *          could the other side come back? should we keep the button?
 *        set the state based on the OTR library state
 */

  addButton(aObject) {
    this.globalDoc = aObject.ownerDocument;
    let _conv = aObject._conv;
    OTRUI.setMsgState(_conv, null, this.globalDoc, true);
  },

  hideOTRButton() {
    if (!OTR.libLoaded)
      return;
    if (!this.globalDoc)
      return;
    OTRUI.visibleConv = null;
    let otrContainer = this.globalDoc.querySelector(".otr-container");
    OTRUI.noOtrPossible(otrContainer);
  },

  updateOTRButton(_conv) {
    if (!OTR.libLoaded)
      return;
    if (!this.globalDoc)
      return;
    OTRUI.visibleConv = _conv;
    let convBinding =
      this.globalDoc.getElementById("conversationsDeck").selectedPanel;
    if (convBinding && convBinding._conv && convBinding._conv.target) {
      OTRUI.setMsgState(_conv, null, this.globalDoc, false);
    } else {
      this.hideOTRButton();
    }
  },

  // set msg state on toolbar button
  setMsgState(_conv, context, doc, addSystemMessage) {
    if (!this.visibleConv) {
      return;
    }
    if (_conv != null && !(_conv === this.visibleConv)) {
      return;
    }

    let otrContainer = doc.querySelector(".otr-container");
    let otrButton = doc.querySelector(".otr-button");
    if (_conv != null && _conv.isChat) {
      OTRUI.noOtrPossible(otrContainer, context);
      return;
    }

    if (!context && _conv != null) {
      context = OTR.getContext(_conv);
      if (!context) {
        OTRUI.noOtrPossible(otrContainer, null);
      }
    }

    try {
      let uiConv = OTR.getUIConvFromContext(context);
      if (uiConv != null && !(uiConv === this.visibleConv)) {
        return;
      }

      if (uiConv.isChat) {
        OTRUI.noOtrPossible(otrContainer, context);
        return;
      }
      if (addSystemMessage) {
        let trust = OTRUI.getTrustSettings(context);
        uiConv.systemMessage(_("state." + trust.class, context.username));
      }
    } catch (e) {
      OTRUI.noOtrPossible(otrContainer, context);
      return;
    }

    otrContainer.hidden = false;
    let otrStart = doc.querySelector(".otr-start");
    let otrEnd = doc.querySelector(".otr-end");
    let otrAuth = doc.querySelector(".otr-auth");
    let trust = OTRUI.getTrustSettings(context);
    otrButton.setAttribute("tooltiptext", _("state." + trust.class, context.username));
    otrButton.setAttribute("label", _("state." + trust.class + ".label"));
    otrButton.className = "otr-button otr-" + trust.class;
    otrStart.setAttribute("label", trust.startLabel);
    otrStart.setAttribute("disabled", trust.disableStart);
    otrEnd.setAttribute("disabled", trust.disableEnd);
    otrAuth.setAttribute("label", trust.authLabel);
    otrAuth.setAttribute("disabled", trust.disableAuth);
    OTRUI.hideAllNotifications();
    OTRUI.showUserNotifications(context);
  },

  alertTrust(context) {
    let uiConv = OTR.getUIConvFromContext(context);
    let trust = OTRUI.getTrustSettings(context);
    uiConv.systemMessage(_("afterauth." + trust.class, context.username));
  },

  getTrustSettings(context) {
    let result = trustMap.get(OTR.trust(context));
    return result;
  },

  askAuth(aObject) {
    let uiConv = OTR.getUIConvFromContext(aObject.context);
    if (!uiConv) return;

    let window = this.globalDoc.defaultView;
    let name = uiConv.target.normalizedName;
    OTRUI.openAuth(window, name, "ask", uiConv, aObject);
  },

  closeUnverified(context) {
    let uiConv = OTR.getUIConvFromContext(context);
    if (!uiConv) return;

    let notification = this.globalBox.getNotificationWithValue(authVerify);
    if (notification)
      notification.close();
  },

  hideUserNotifications(context) {
    let notifications = this.globalBox.allNotifications;
    for (let i = notifications.length - 1; i >= 0; i--) {
      if (context.username == notifications[i].getAttribute("user")) {
        notifications[i].setAttribute("hidden", "true");
      }
    }
  },

  hideAllNotifications() {
    let notifications = this.globalBox.allNotifications;
    for (let i = notifications.length - 1; i >= 0; i--) {
      notifications[i].setAttribute("hidden", "true");
    }
  },

  showUserNotifications(context) {
    let notifications = this.globalBox.allNotifications;
    for (let i = notifications.length - 1; i >= 0; i--) {
      if (context.username == notifications[i].getAttribute("user"))
        notifications[i].removeAttribute("hidden");
    }
  },

  notifyUnverified(context, seen) {
    let uiConv = OTR.getUIConvFromContext(context);
    if (!uiConv) return;

    if (this.globalBox.getNotificationWithValue(authVerify))
      return;

    let window = this.globalDoc.defaultView;

    let msg = _("finger." + seen, context.username);
    let buttons = [{
      label: _("finger.verify"),
      accessKey: _("verify.accessKey"),
      callback() {
        let name = uiConv.target.normalizedName;
        OTRUI.openAuth(window, name, "start", uiConv);
        // prevent closing of notification bar when the button is hit
        return true;
      },
    }];

    let priority = this.globalBox.PRIORITY_WARNING_MEDIUM;
    this.globalBox.appendNotification(msg, authVerify, null, priority, buttons, null);

    this.updateNotificationUI(context, "verify", authVerify);
  },

  updateNotificationUI(context, type, value) {
    let notification = this.globalBox.getNotificationWithValue(value);
    notification.setAttribute("user", context.username);
    notification.setAttribute("orient", "vertical");
    notification.messageDetails.setAttribute("orient", "vertical");
    notification.messageDetails.removeAttribute("oncommand");
    notification.messageDetails.removeAttribute("align");

    let title = this.globalDoc.createElement("title");
    title.setAttribute("flex", "1");
    title.setAttribute("crop", "end");
    title.textContent = _(type + ".title");

    let close = notification.querySelector("toolbarbutton");
    close.setAttribute("oncommand", "this.parentNode.parentNode.dismiss();");

    let top = this.globalDoc.createElement("hbox");
    top.setAttribute("flex", "1");
    top.setAttribute("align", "center");
    top.classList.add("otr-notification-header");
    top.appendChild(notification.messageImage);
    top.appendChild(title);
    top.appendChild(close);
    notification.insertBefore(top, notification.messageDetails);

    let bottom = this.globalDoc.createElement("hbox");
    bottom.setAttribute("flex", "1");
    bottom.setAttribute("oncommand", "this.parentNode._doButtonCommand(event);");
    bottom.classList.add("otr-notification-footer");

    notification.querySelectorAll("button").forEach((e) => {
      bottom.appendChild(e);
    });

    notification.appendChild(bottom);
  },

  closeVerification(context) {
    let uiConv = OTR.getUIConvFromContext(context);
    if (!uiConv) return;

    authLabelMap.forEach(function(_, key) {
      let prevNotification = OTRUI.globalBox.getNotificationWithValue(key);
      if (prevNotification)
        prevNotification.close();
    });
  },

  notifyVerification(context, key, cancelable) {
    let uiConv = OTR.getUIConvFromContext(context);
    if (!uiConv) return;

    // TODO: maybe update the .label property on the notification instead
    // of closing it ... although, buttons need to be updated too.
    OTRUI.closeVerification(context);

    let msg = authLabelMap.get(key);
    let type = authTitleMap.get(key);
    let buttons = [];
    if (cancelable) {
      buttons = [{
        label: _("auth.cancel"),
        accessKey: _("auth.cancelAccessKey"),
        callback() {
          let context = OTR.getContext(uiConv.target);
          OTR.abortSMP(context);
        },
      }];
    }

    // higher priority to overlay the current notifyUnverified
    let priority = this.globalBox.PRIORITY_WARNING_HIGH;
    OTRUI.closeUnverified(context);
    this.globalBox.appendNotification(msg, key, null, priority, buttons, null);

    this.updateNotificationUI(context, type, key);
  },

  updateAuth(aObj) {
    // let uiConv = OTR.getUIConvFromContext(aObj.context);
    if (!aObj.progress) {
      OTRUI.closeAuth(aObj.context);
      OTRUI.notifyVerification(aObj.context, "otr:auth-error", false);
    } else if (aObj.progress === 100) {
      let key;
      if (aObj.success) {
        if (aObj.context.trust) {
          key = "otr:auth-success";
          OTR.notifyTrust(aObj.context);
        } else {
          key = "otr:auth-successThem";
        }
      } else {
        key = "otr:auth-fail";
        if (!aObj.context.trust)
          OTR.notifyTrust(aObj.context);
      }
      OTRUI.notifyVerification(aObj.context, key, false);
    } else {
      // TODO: show the aObj.progress to the user with a
      //   <progressmeter mode="determined" value="10" />
      OTRUI.notifyVerification(aObj.context, "otr:auth-waiting", true);
    }
  },

  generate(args) {
    let features = "chrome,modal,centerscreen,resizable=no,minimizable=no";
    args.wrappedJSObject = args;
    Services.ww.openWindow(null, privDialog, "", features, args);
  },

  onAccountCreated(acc) {
    let account = acc.normalizedName;
    let protocol = acc.protocol.normalizedName;
    Promise.resolve();
    if (OTR.privateKeyFingerprint(account, protocol) === null)
      OTR.generatePrivateKey(account, protocol);
  },

  contactWrapper(contact) {
    let wrapper = {
      account: contact.preferredBuddy.preferredAccountBuddy.account.normalizedName,
      protocol: contact.preferredBuddy.protocol.normalizedName,
      screenname: contact.preferredBuddy.preferredAccountBuddy.userName,
    };
    return wrapper;
  },

  onContactAdded(contact) {
    let args = OTRUI.contactWrapper(contact);
    if (OTR.getFingerprintsForRecipient(args.account, args.protocol, args.screenname).length > 0)
      return;
    args.wrappedJSObject = args;
    let features = "chrome,modal,centerscreen,resizable=no,minimizable=no";
    Services.ww.openWindow(null, addFingerDialog, "", features, args);
  },

  observe(aObject, aTopic, aMsg) {
    let doc;
    // console.log("====> observing topic: " + aTopic + " with msg: " + aMsg);
    // console.log(aObject);

    switch (aTopic) {
    case "nsPref:changed":
      OTRUI.changePref(aMsg);
      break;
    case "conversation-loaded":
      doc = aObject.ownerDocument;
      let windowtype = doc.documentElement.getAttribute("windowtype");
      if (windowtype !== "mail:3pane") {
        return;
      }
      OTRUI.addButton(aObject);
      break;
    case "conversation-closed":
      if (aObject.isChat)
        return;
      this.globalBox.removeAllNotifications();
      OTRUI.closeAuth(OTR.getContext(aObject));
      OTRUI.disconnect(aObject);
      break;
    // case "contact-signed-off":
    //  break;
    case "prpl-quit":
      OTRUI.disconnect(null);
      break;
    case "domwindowopened":
      OTRUI.addMenus(aObject);
      break;
    case "otr:generate":
      OTRUI.generate(aObject);
      break;
    case "otr:disconnected":
    case "otr:msg-state":
      if (aTopic === "otr:disconnected" ||
          OTR.trust(aObject) !== OTR.trustState.TRUST_UNVERIFIED) {
        OTRUI.closeAuth(aObject);
        OTRUI.closeUnverified(aObject);
        OTRUI.closeVerification(aObject);
      }
      OTRUI.setMsgState(null, aObject, this.globalDoc, false);
      break;
    case "otr:unverified":
      OTRUI.notifyUnverified(aObject, aMsg);
      break;
    case "otr:trust-state":
      OTRUI.alertTrust(aObject);
      break;
    case "otr:log":
      OTRUI.logMsg("otr: " + aObject);
      break;
    case "account-added":
      OTRUI.onAccountCreated(aObject);
      break;
    case "contact-added":
      OTRUI.onContactAdded(aObject);
      break;
    case "otr:auth-ask":
      OTRUI.askAuth(aObject);
      break;
    case "otr:auth-update":
      OTRUI.updateAuth(aObject);
      break;
    }
  },

  initConv(binding) {
    OTR.addConversation(binding._conv);
    OTRUI.addButton(binding);
  },

  resetConv(binding) {
    OTR.removeConversation(binding._conv);
    let otrButton = this.globalDoc.querySelector(".otr-button");
    if (!otrButton)
      return;
    otrButton.remove();
  },

  destroy() {
    if (!OTR.libLoaded)
      return;
    OTRUI.disconnect(null);
    Services.obs.removeObserver(OTR, "new-ui-conversation");
    // Services.obs.removeObserver(OTRUI, "contact-added");
    // Services.obs.removeObserver(OTRUI, "contact-signed-off");
    Services.obs.removeObserver(OTRUI, "account-added");
    Services.obs.removeObserver(OTRUI, "conversation-loaded");
    Services.obs.removeObserver(OTRUI, "conversation-closed");
    Services.obs.removeObserver(OTRUI, "prpl-quit");

    let conversations = Services.conversations.getConversations();
    while (conversations.hasMoreElements()) {
      OTRUI.resetConv(conversations.getNext());
    }
    OTRUI.prefs.removeObserver("", OTRUI);
    OTR.removeObserver(OTRUI);
    OTR.close();
    OTRUI.removeMenuObserver();
  },

};