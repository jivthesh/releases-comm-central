/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Instantbird messenging client, released
 * 2007.
 *
 * The Initial Developer of the Original Code is
 * Florian QUEZE <florian@instantbird.org>.
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const events = ["buddy-signed-on",
                "buddy-signed-off",
                "buddy-removed",
                "buddy-away",
                "buddy-idle",
                "account-connected",
                "account-disconnected",
                "new-text",
                "new-conversation",
                "purple-quit"];

const autoJoinPref = "autoJoin";

var buddyList = {
  observe: function bl_observe(aBuddy, aTopic, aMsg) {
    //dump("received signal: " + aTopic + "\n");

    if (aTopic == "purple-quit") {
      window.close();
      return;
    }

    if (aTopic == "new-text" || aTopic == "new-conversation") {
/*
      var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Components.interfaces.nsIWindowMediator);
      var win = wm.getMostRecentWindow("Messenger:convs");
*/
      if (this.win && this.win.closed)
        this.win = null;

      if (!this.win) {
        this.win = window.open(convWindow, "Conversations", "chrome,resizable");
        this.win.pendingNotifications = [{object: aBuddy, topic: aTopic, msg: aMsg}];
      }
      else if (this.win.pendingNotifications)
        this.win.pendingNotifications.push({object: aBuddy, topic: aTopic, msg: aMsg});

      return;
    }

    if (aTopic == "account-connected" || aTopic == "account-disconnected") {
      var account = aBuddy.QueryInterface(Ci.purpleIAccount);
      if (account.protocol.id == "prpl-irc") {
        this.checkForIrcAccount();
        if (aTopic == "account-connected") {
          var branch = Components.classes["@mozilla.org/preferences-service;1"]
                                 .getService(Ci.nsIPrefService)
                                 .getBranch("messenger.account." +
                                            account.id + ".");
          if (branch.prefHasUserValue(autoJoinPref)) {
            var autojoin = branch.getCharPref(autoJoinPref);
            if (autojoin) {
              autojoin = autojoin.split(",");
              for (var i = 0; i < autojoin.length; ++i)
                account.joinChat(autojoin[i]);
            }
          }
        }
      }
      this.checkNotDisconnected();
      return;
    }

    var pab = aBuddy.QueryInterface(Ci.purpleIAccountBuddy);
    var group = pab.tag;
    var groupId = "group" + group.id;
    var groupElt = document.getElementById(groupId);
    if (aTopic == "buddy-signed-on") {
      if (!groupElt) {
        groupElt = document.createElement("group");
        var parent = document.getElementById("buddylistbox");
        parent.appendChild(groupElt);
        groupElt.build(group);
      }
      groupElt.addBuddy(pab);
      return;
    }

    if (aTopic == "buddy-signed-off" ||
        (aTopic == "buddy-removed" && groupElt)) {
      groupElt.signedOff(pab);
    }

    if (aTopic == "buddy-idle" || aTopic == "buddy-away")
      groupElt.updateBuddy(pab);
  },

  getAccounts: function bl_getAccounts() {
    var pcs = Components.classes["@instantbird.org/purple/core;1"]
                        .getService(Ci.purpleICoreService);
    return getIter(pcs.getAccounts, Ci.purpleIAccount);
  },
  checkNotDisconnected: function bl_checkNotDisconnected() {
    var addBuddyItem = document.getElementById("addBuddyMenuItem");

    for (let acc in this.getAccounts())
      if (acc.connected || acc.connecting) {
        addBuddyItem.disabled = false;
        return;
      }

    addBuddyItem.disabled = true;
    menus.accounts();
  },
  checkForIrcAccount: function bl_checkForIrcAccount() {
    var joinChatItem = document.getElementById("joinChatMenuItem");

    for (let acc in this.getAccounts())
      if (acc.connected && acc.protocol.id == "prpl-irc") {
        joinChatItem.disabled = false;
        return;
      }

    joinChatItem.disabled = true;
  },

  load: function bl_load() {
    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                       .getService(Components.interfaces.nsIWindowMediator);
    var blistWindows = wm.getEnumerator("Messenger:blist");
    while (blistWindows.hasMoreElements()) {
      var win = blistWindows.getNext();
      if (win != window) {
        win.QueryInterface(Components.interfaces.nsIDOMWindowInternal).focus();
        window.close();
        return;
      }
    }

    initPurpleCore();
    buddyList.checkNotDisconnected();
    buddyList.checkForIrcAccount();
    addObservers(buddyList, events);
    this.addEventListener("unload", buddyList.unload, false);
  },
  unload: function bl_unload() {
    removeObservers(buddyList, events);
    uninitPurpleCore();
  },

  getAway: function bl_getAway() {
    // prompt the user to enter an away message
    var prompts = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                           .getService(Components.interfaces.nsIPromptService);
    var bundle = document.getElementById("awayBundle");
    var message = {value: bundle.getString("away.default.message")};
    if (!prompts.prompt(window, bundle.getString("away.prompt.title"),
                        bundle.getString("away.prompt.message"), message,
                        null, {value: false}))
      return; // the user canceled

    // actually get away
    var pcs = Components.classes["@instantbird.org/purple/core;1"]
                        .getService(Components.interfaces.purpleICoreService);
    pcs.away(message.value);

    // display the notification on the buddy list
    var buttons = [{
      accessKey: "",
      label: bundle.getString("away.back.button"),
      popup: null,
      callback: buddyList.getBack
    }];
    var nbox = document.getElementById("buddyListMsg");
    var notif = nbox.appendNotification(message.value, null,
                                        "chrome://instantbird/skin/away-16.png",
                                        nbox.PRIORITY_INFO_MEDIUM, buttons);
    notif.setAttribute("hideclose", "true");
    document.getElementById("getAwayMenuItem").disabled = true;
  },
  getBack: function bl_getBack() {
    var pcs = Components.classes["@instantbird.org/purple/core;1"]
                        .getService(Components.interfaces.purpleICoreService);
    pcs.back(null);
    document.getElementById("getAwayMenuItem").disabled = false;
  },

  // Handle key pressing
  keyPress: function bl_keyPress(aEvent) {
    switch (aEvent.keyCode) {

      // If Enter or Return is pressed, open a new conversation
      case aEvent.DOM_VK_RETURN:
      case aEvent.DOM_VK_ENTER:
        var item = document.getElementById("buddylistbox").selectedItem;
        if (item.localName == "buddy")
          item.openConversation();
        break;
    }
    return;
  }
};

function initPurpleCore()
{
  try {
    var pcs = Components.classes["@instantbird.org/purple/core;1"]
                        .getService(Ci.purpleICoreService);
    pcs.init();
  }
  catch (e) {
    alert(e);
  }
}

function uninitPurpleCore()
{
  try {
    var pcs = Components.classes["@instantbird.org/purple/core;1"]
                        .getService(Ci.purpleICoreService);
    pcs.quit();
  }
  catch (e) {
    alert(e);
  }
}

this.addEventListener("load", buddyList.load, false);
