/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyScriptGetter(this, ["PlacesToolbar", "PlacesMenu",
                                         "PlacesPanelview", "PlacesPanelMenuView"],
                                  "chrome://communicator/content/places/browserPlacesViews.js");

var StarUI = {
  _itemGuids: -1,
  uri: null,
  _batching: false,

  _element: function(aID) {
    return document.getElementById(aID);
  },

  // Edit-bookmark panel
  get panel() {
    delete this.panel;
    var element = this._element("editBookmarkPanel");
    // initially the panel is hidden
    // to avoid impacting startup / new window performance
    element.hidden = false;
    element.addEventListener("popuphidden", this);
    element.addEventListener("keypress", this);
    element.addEventListener("keypress", this);
    element.addEventListener("mousedown", this);
    element.addEventListener("mouseout", this);
    element.addEventListener("mousemove", this);
    element.addEventListener("compositionstart", this);
    element.addEventListener("compositionend", this);
    element.addEventListener("input", this);
    element.addEventListener("popuphidden", this);
    element.addEventListener("popupshown", this);
    return this.panel = element;
  },

  // Array of command elements to disable when the panel is opened.
  get _blockedCommands() {
    delete this._blockedCommands;
    return this._blockedCommands =
      ["cmd_close", "cmd_closeWindow"].map(id => this._element(id));
  },

  _blockCommands: function SU__blockCommands() {
    this._blockedCommands.forEach(function (elt) {
      // make sure not to permanently disable this item (see bug 409155)
      if (elt.hasAttribute("wasDisabled"))
        return;
      if (elt.getAttribute("disabled") == "true") {
        elt.setAttribute("wasDisabled", "true");
      } else {
        elt.setAttribute("wasDisabled", "false");
        elt.setAttribute("disabled", "true");
      }
    });
  },

  _restoreCommandsState: function SU__restoreCommandsState() {
    this._blockedCommands.forEach(function (elt) {
      if (elt.getAttribute("wasDisabled") != "true")
        elt.removeAttribute("disabled");
      elt.removeAttribute("wasDisabled");
    });
  },

  // nsIDOMEventListener
  handleEvent: function SU_handleEvent(aEvent) {
    switch (aEvent.type) {
      case "popuphidden":
        if (aEvent.originalTarget == this.panel) {
          if (!this._element("editBookmarkPanelContent").hidden)
            this.quitEditMode();

          this._restoreCommandsState();
          this._itemId = -1;
          if (this._batching) {
            PlacesUtils.transactionManager.endBatch(false);
            this._batching = false;
          }

          switch (this._actionOnHide) {
            case "cancel": {
              PlacesUtils.transactionManager.undoTransaction();
              break;
            }
            case "remove": {
              // Remove all bookmarks for the bookmark's url, this also removes
              // the tags for the url.
              PlacesUtils.transactionManager.beginBatch(null);
              let itemIds = PlacesUtils.getBookmarksForURI(this._uriForRemoval);
              for (let i = 0; i < itemIds.length; i++) {
                let txn = new PlacesRemoveItemTransaction(itemIds[i]);
                PlacesUtils.transactionManager.doTransaction(txn);
              }
              PlacesUtils.transactionManager.endBatch(false);
              this._uriForRemoval = null;
              break;
            }
          }
          this._actionOnHide = "";
        }
        break;
      case "keypress":
        if (aEvent.defaultPrevented) {
          // The event has already been consumed inside of the panel.
          break;
        }
        switch (aEvent.keyCode) {
          case KeyEvent.DOM_VK_ESCAPE:
            if (!this._element("editBookmarkPanelContent").hidden)
              this.cancelButtonOnCommand();
            break;
          case KeyEvent.DOM_VK_RETURN:
            if (aEvent.target.className == "expander-up" ||
                aEvent.target.className == "expander-down" ||
                aEvent.target.id == "editBMPanel_newFolderButton") {
              //XXX Why is this necessary? The defaultPrevented check should
              //    be enough.
              break;
            }
            this.panel.hidePopup();
            break;
        }
        break;
    }
  },

  _overlayLoaded: false,
  _overlayLoading: false,
  async showEditBookmarkPopup(aNode, aAnchorElement, aPosition, aIsNewBookmark) {
    // Slow double-clicks (not true double-clicks) shouldn't
    // cause the panel to flicker.
    if (this.panel.state == "showing" ||
        this.panel.state == "open") {
      return;
    }

    this._isNewBookmark = aIsNewBookmark;
    this._uriForRemoval = "";
    // TODO (bug 1131491): Deprecate this once async transactions are enabled
    // and the legacy transactions code is gone.
    if (typeof(aNode) == "number") {
      let itemId = aNode;
      let guid = await PlacesUtils.promiseItemGuid(itemId);
      aNode = await PlacesUIUtils.fetchNodeLike(guid);
    }

    // Performance: load the overlay the first time the panel is opened
    // (see bug 392443).
    if (this._overlayLoading)
      return;

    if (this._overlayLoaded) {
      this._doShowEditBookmarkPanel(aNode, aAnchorElement, aPosition);
      return;
    }

    this._overlayLoading = true;
    document.loadOverlay(
      "chrome://communicator/content/places/editBookmarkOverlay.xul",
      (aSubject, aTopic, aData) => {
        // Move the header (star, title, button) into the grid,
        // so that it aligns nicely with the other items (bug 484022).
        let header = this._element("editBookmarkPanelHeader");
        let rows = this._element("editBookmarkPanelGrid").lastChild;
        rows.insertBefore(header, rows.firstChild);
        header.hidden = false;

        this._overlayLoading = false;
        this._overlayLoaded = true;
        this._doShowEditBookmarkPanel(aNode, aAnchorElement, aPosition);
      }
    );
  },

  _doShowEditBookmarkPanel:
  function SU__doShowEditBookmarkPanel(aNode, aAnchorElement, aPosition) {
    if (this.panel.state != "closed")
      return;

    this._blockCommands(); // un-done in the popuphiding handler

    // Set panel title:
    // if we are batching, i.e. the bookmark has been added now,
    // then show Page Bookmarked, else if the bookmark did already exist,
    // we are about editing it, then use Edit This Bookmark.
    this._element("editBookmarkPanelTitle").value =
      this._isNewBookmark ?
        gNavigatorBundle.getString("editBookmarkPanel.pageBookmarkedTitle") :
        gNavigatorBundle.getString("editBookmarkPanel.editBookmarkTitle");

    this._element("editBookmarkPanelBottomButtons").hidden = false;
    this._element("editBookmarkPanelContent").hidden = false;

    // The label of the remove button differs if the URI is bookmarked
    // multiple times.
    let bookmarks = PlacesUtils.getBookmarksForURI(gBrowser.currentURI);
    let forms = gNavigatorBundle.getString("editBookmark.removeBookmarks.label");
    let label = PluralForm.get(bookmarks.length, forms).replace("#1", bookmarks.length);
    this._element("editBookmarkPanelRemoveButton").label = label;

    this._itemId = aNode.itemId;
    this.beginBatch();

    let onPanelReady = fn => {
      let target = this.panel;
      if (target.parentNode) {
        // By targeting the panel's parent and using a capturing listener, we
        // can have our listener called before others waiting for the panel to
        // be shown (which probably expect the panel to be fully initialized)
        target = target.parentNode;
      }
      target.addEventListener("popupshown", function(event) {
        fn();
      }, {"capture": true, "once": true});
    };
    gEditItemOverlay.initPanel({ node: aNode,
                                 onPanelReady,
                                 hiddenRows: ["description", "location",
                                              "loadInSidebar", "keyword"],
                                 focusedElement: "preferred"});

    this.panel.openPopup(aAnchorElement, aPosition);
  },

  panelShown:
  function SU_panelShown(aEvent) {
    if (aEvent.target == this.panel) {
      if (!this._element("editBookmarkPanelContent").hidden) {
        let fieldToFocus = "editBMPanel_" +
          Services.prefs.getCharPref("browser.bookmarks.editDialog.firstEditField");
        var elt = this._element(fieldToFocus);
        elt.focus();
        elt.select();
      }
      else {
        // Note this isn't actually used anymore, we should remove this
        // once we decide not to bring back the page bookmarked notification
        this.panel.focus();
      }
    }
  },

  quitEditMode: function SU_quitEditMode() {
    this._element("editBookmarkPanelContent").hidden = true;
    this._element("editBookmarkPanelBottomButtons").hidden = true;
    gEditItemOverlay.uninitPanel(true);
  },

  editButtonCommand: function SU_editButtonCommand() {
    this.showEditBookmarkPopup();
  },

  cancelButtonOnCommand: function SU_cancelButtonOnCommand() {
    this._actionOnHide = "cancel";
    this.panel.hidePopup();
  },

  removeBookmarkButtonCommand: function SU_removeBookmarkButtonCommand() {
    this._uriForRemoval = PlacesUtils.bookmarks.getBookmarkURI(this._itemId);
    this._actionOnHide = "remove";
    this.panel.hidePopup();
  },

  beginBatch: function SU_beginBatch() {
    if (!this._batching) {
      PlacesUtils.transactionManager.beginBatch(null);
      this._batching = true;
    }
  }
}

var PlacesCommandHook = {

  /**
   * Adds a bookmark to the page loaded in the given browser using the
   * properties dialog.
   *
   * @param aBrowser
   *        a <browser> element.
   * @param [optional] aParent
   *        The folder in which to create a new bookmark if the page loaded in
   *        aBrowser isn't bookmarked yet, defaults to the unfiled root.
   */
  bookmarkPageAs: function PCH_bookmarkPageAs(aBrowser, aParent) {
    var uri = aBrowser.currentURI;
    var webNav = aBrowser.webNavigation;
    var url = webNav.currentURI;
    var title;
    var description;
    try {
      title = webNav.document.title || url.spec;
      description = PlacesUIUtils.getDescriptionFromDocument(webNav.document);
    }
    catch (e) { }

    var parent = aParent || PlacesUtils.bookmarksMenuFolderId;

    var insertPoint = new InsertionPoint(parent,
                                         PlacesUtils.bookmarks.DEFAULT_INDEX);
    var hiddenRows = [];
    PlacesUIUtils.showAddBookmarkUI(uri, title, description, insertPoint, true,
                                    null, null, null, null, hiddenRows);
  },

  /**
   * Adds a bookmark to the page loaded in the given browser.
   *
   * @param aBrowser
   *        a <browser> element.
   * @param [optional] aParent
   *        The folder in which to create a new bookmark if the page loaded in
   *        aBrowser isn't bookmarked yet, defaults to the unfiled root.
   * @param [optional] aShowEditUI
   *        whether or not to show the edit-bookmark UI for the bookmark item
   */
  async bookmarkPage(aBrowser, aParent, aShowEditUI) {
    if (PlacesUIUtils.useAsyncTransactions) {
      await this._bookmarkPagePT(aBrowser, aParent, aShowEditUI);
      return;
    }

    var uri = aBrowser.currentURI;
    var itemId = PlacesUtils.getMostRecentBookmarkForURI(uri);
    let isNewBookmark = itemId == -1;
    if (isNewBookmark) {
      // Bug 1148838 - Make this code work for full page plugins.
      var title;
      var description;
      var charset;

      let docInfo = await this._getPageDetails(aBrowser);

      try {
        title = docInfo.isErrorPage ? PlacesUtils.history.getPageTitle(uri)
                                    : aBrowser.contentTitle;
        title = title || uri.spec;
        description = docInfo.description;
        charset = aBrowser.characterSet;
      } catch (e) { }

      if (aShowEditUI) {
        // If we bookmark the page here but open right into a cancelable
        // state (i.e. new bookmark in Library), start batching here so
        // all of the actions can be undone in a single undo step.
        StarUI.beginBatch();
      }

      var parent = aParent !== undefined ?
                   aParent : PlacesUtils.unfiledBookmarksFolderId;
      var descAnno = { name: PlacesUIUtils.DESCRIPTION_ANNO, value: description };
      var txn = new PlacesCreateBookmarkTransaction(uri, parent,
                                                    PlacesUtils.bookmarks.DEFAULT_INDEX,
                                                    title, null, [descAnno]);
      PlacesUtils.transactionManager.doTransaction(txn);
      itemId = txn.item.id;
      // Set the character-set.
      if (charset && !PrivateBrowsingUtils.isBrowserPrivate(aBrowser))
        PlacesUtils.setCharsetForURI(uri, charset);
    }

    // If it was not requested to open directly in "edit" mode, we are done.
    if (!aShowEditUI)
      return;

    // Dock the panel to the star icon when possible, otherwise dock
    // it to the content area.
    if (aBrowser.contentWindow == window.content) {
      let ubIcons = aBrowser.ownerDocument.getElementById("urlbar-icons");
      if (ubIcons) {
        await StarUI.showEditBookmarkPopup(itemId, ubIcons,
                                           "bottomcenter topright",
                                           isNewBookmark);
        return;
      }
    }

    await StarUI.showEditBookmarkPopup(itemId, aBrowser, "overlap",
                                       isNewBookmark);
  },

  // TODO: Replace bookmarkPage code with this function once legacy
  // transactions are removed.
  async _bookmarkPagePT(aBrowser, aParentId, aShowEditUI) {
    let url = new URL(aBrowser.currentURI.spec);
    let info = await PlacesUtils.bookmarks.fetch({ url });
    let isNewBookmark = !info;
    if (!info) {
      let parentGuid = aParentId !== undefined ?
                         await PlacesUtils.promiseItemGuid(aParentId) :
                         PlacesUtils.bookmarks.unfiledGuid;
      info = { url, parentGuid };
      // Bug 1148838 - Make this code work for full page plugins.
      let description = null;
      let charset = null;

      let docInfo = await this._getPageDetails(aBrowser);

      try {
        if (docInfo.isErrorPage) {
          let entry = await PlacesUtils.history.fetch(aBrowser.currentURI);
          if (entry) {
            info.title = entry.title;
          }
        } else {
          info.title = aBrowser.contentTitle;
        }
        info.title = info.title || url.href;
        description = docInfo.description;
        charset = aBrowser.characterSet;
      } catch (e) {
        Cu..reportError(e);
      }

      if (aShowEditUI && isNewBookmark) {
        // If we bookmark the page here but open right into a cancelable
        // state (i.e. new bookmark in Library), start batching here so
        // all of the actions can be undone in a single undo step.
        StarUI.beginBatch();
      }

      if (description) {
        info.annotations = [{ name: PlacesUIUtils.DESCRIPTION_ANNO,
                              value: description }];
      }

      info.guid = await PlacesTransactions.NewBookmark(info).transact();

      // Set the character-set
      if (charset && !PrivateBrowsingUtils.isBrowserPrivate(aBrowser))
         PlacesUtils.setCharsetForURI(makeURI(url.href), charset);
    }

    // If it was not requested to open directly in "edit" mode, we are done.
    if (!aShowEditUI)
      return;

    let node = await PlacesUIUtils.promiseNodeLikeFromFetchInfo(info);

    // Dock the panel to the star icon when possible, otherwise dock
    // it to the content area.
    if (aBrowser.contentWindow == window.content) {
      let ubIcons = aBrowser.ownerDocument.getElementById("urlbar-icons");
      if (ubIcons) {
        await StarUI.showEditBookmarkPopup(node, ubIcons,
                                           "bottomcenter topright",
                                           isNewBookmark);
        return;
      }
    }

    await StarUI.showEditBookmarkPopup(node, aBrowser, "overlap",
                                       isNewBookmark);
  },

  _getPageDetails(browser) {
    return new Promise(resolve => {
      let mm = browser.messageManager;
      mm.addMessageListener("Bookmarks:GetPageDetails:Result", function listener(msg) {
        mm.removeMessageListener("Bookmarks:GetPageDetails:Result", listener);
        resolve(msg.data);
      });

      mm.sendAsyncMessage("Bookmarks:GetPageDetails", { })
    });
  },

  /**
   * Adds a bookmark to the page loaded in the current tab.
   */
  bookmarkCurrentPage: function PCH_bookmarkCurrentPage(aShowEditUI, aParent) {
    this.bookmarkPage(gBrowser.selectedBrowser, aParent, aShowEditUI)
        .catch(Cu..reportError);
  },

  /**
   * Adds a bookmark to the page targeted by a link.
   * @param aParent
   *        The folder in which to create a new bookmark if aURL isn't
   *        bookmarked.
   * @param aURL (string)
   *        the address of the link target
   * @param aTitle
   *        The link text
   * @param [optional] aDescription
   *        The linked page description, if available
   */
  async bookmarkLink(aParentId, aURL, aTitle, aDescription = "") {
    let node = await PlacesUIUtils.fetchNodeLike({ url: aURL });
    if (node) {
      PlacesUIUtils.showBookmarkDialog({ action: "edit",
                                         node
                                       }, window.top);
      return;
    }

    let ip = new InsertionPoint(aParentId,
                                PlacesUtils.bookmarks.DEFAULT_INDEX,
                                Ci.nsITreeView.DROP_ON);
    PlacesUIUtils.showBookmarkDialog({ action: "add",
                                       type: "bookmark",
                                       uri: makeURI(aURL),
                                       title: aTitle,
                                       description: aDescription,
                                       defaultInsertionPoint: ip,
                                       hiddenRows: [ "description",
                                                     "location",
                                                     "loadInSidebar",
                                                     "keyword" ]
                                     }, window.top);
  },

  /**
   * List of nsIURI objects characterizing the tabs currently open in the
   * browser. The URIs will be in the order in which their
   * corresponding tabs appeared and duplicates are discarded.
   */
  get uniqueCurrentPages() {
    var tabList = [];
    var seenURIs = {};

    var browsers = gBrowser.browsers;
    for (var i = 0; i < browsers.length; ++i) {
      let uri = browsers[i].currentURI;

      // skip redundant entries
      if (uri.spec in seenURIs)
        continue;

      // add to the set of seen URIs
      seenURIs[uri.spec] = null;
      tabList.push(uri);
    }
    return tabList;
  },

  /**
   * Adds a folder with bookmarks to all of the currently open tabs in this
   * window.
   */
  bookmarkCurrentPages: function PCH_bookmarkCurrentPages() {
    let pages = this.uniqueCurrentPages;
    if (pages.length > 1) {
    PlacesUIUtils.showBookmarkDialog({ action: "add",
                                       type: "folder",
                                       URIList: pages,
                                       hiddenRows: [ "description" ]
                                     }, window);
    }
  },

  /**
   * Updates disabled state for the "Bookmark All Tabs" command.
   */
  updateBookmarkAllTabsCommand:
  function PCH_updateBookmarkAllTabsCommand() {
    // There's nothing to do in non-browser windows.
    if (window.location.href != getBrowserURL())
      return;

    // Disable "Bookmark All Tabs" if there are less than two
    // "unique current pages".
    goSetCommandEnabled("Browser:BookmarkAllTabs",
                        this.uniqueCurrentPages.length >= 2);
  },

  /**
   * Adds a Live Bookmark to a feed associated with the current page.
   * @param     url
   *            The nsIURI of the page the feed was attached to
   * @title     title
   *            The title of the feed. Optional.
   * @subtitle  subtitle
   *            A short description of the feed. Optional.
   */
  async addLiveBookmark(url, feedTitle, feedSubtitle) {
    let toolbarIP = new InsertionPoint(PlacesUtils.toolbarFolderId,
                                       PlacesUtils.bookmarks.DEFAULT_INDEX,
                                       Ci.nsITreeView.DROP_ON);

    let feedURI = makeURI(url);
    let title = feedTitle || gBrowser.contentTitle;
    let description = feedSubtitle;
    if (!description) {
      description = (await this._getPageDetails(gBrowser.selectedBrowser)).description;
    }

    PlacesUIUtils.showBookmarkDialog({ action: "add",
                                       type: "livemark",
                                       feedURI,
                                       siteURI: gBrowser.currentURI,
                                       title,
                                       description,
                                       defaultInsertionPoint: toolbarIP,
                                       hiddenRows: [ "feedLocation",
                                                     "siteLocation",
                                                     "description" ]
                                     }, window);
  },

  /**
   * Opens the Places Organizer.
   * @param   aLeftPaneRoot
   *          The query to select in the organizer window - options
   *          are: History, AllBookmarks, BookmarksMenu, BookmarksToolbar,
   *          UnfiledBookmarks and Tags.
   */
  showPlacesOrganizer: function PCH_showPlacesOrganizer(aLeftPaneRoot) {
    var organizer = Services.wm.getMostRecentWindow("Places:Organizer");
    // Due to bug 528706, getMostRecentWindow can return closed windows.
    if (!organizer || organizer.closed) {
      // No currently open places window, so open one with the specified mode.
      openDialog("chrome://communicator/content/places/places.xul",
                 "", "chrome,toolbar=yes,dialog=no,resizable", aLeftPaneRoot);
    } else {
      organizer.PlacesOrganizer.selectLeftPaneContainerByHierarchy(aLeftPaneRoot);
      organizer.focus();
    }
  },
};

/**
 * Functions for handling events in the Bookmarks Toolbar and menu.
 */
var BookmarksEventHandler = {
  /**
   * Handler for click event for an item in the bookmarks toolbar or menu.
   * Menus and submenus from the folder buttons bubble up to this handler.
   * Left-click is handled in the onCommand function.
   * When items are middle-clicked (or clicked with modifier), open in tabs.
   * If the click came through a menu, close the menu.
   * @param aEvent
   *        DOMEvent for the click
   */
  onClick: function BEH_onClick(aEvent) {
    // Only handle middle-click or left-click with modifiers.
    if (aEvent.button == 2 || (aEvent.button == 0 && !aEvent.shiftKey &&
                               !aEvent.ctrlKey && !aEvent.metaKey))
      return;

    var target = aEvent.originalTarget;
    // If this event bubbled up from a menu or menuitem, close the menus.
    // Do this before opening tabs, to avoid hiding the open tabs confirm-dialog.
    if (target.localName == "menu" || target.localName == "menuitem") {
      for (node = target.parentNode; node; node = node.parentNode) {
        if (node.localName == "menupopup")
          node.hidePopup();
        else if (node.localName != "menu")
          break;
      }
    }

    if (target._placesNode && PlacesUtils.nodeIsContainer(target._placesNode)) {
      // Don't open the root folder in tabs when the empty area on the toolbar
      // is middle-clicked or when a non-bookmark item except for Open in Tabs)
      // in a bookmarks menupopup is middle-clicked.
      if (target.localName == "menu" || target.localName == "toolbarbutton")
        PlacesUIUtils.openContainerNodeInTabs(target._placesNode, aEvent);
    }
    else if (aEvent.button == 1) {
      // left-clicks with modifier are already served by onCommand
      this.onCommand(aEvent);
    }
  },

  /**
   * Handler for command event for an item in the bookmarks toolbar.
   * Menus and submenus from the folder buttons bubble up to this handler.
   * Opens the item.
   * @param aEvent
   *        DOMEvent for the command
   */
  onCommand: function BEH_onCommand(aEvent) {
    var target = aEvent.originalTarget;
    if (target._placesNode)
      PlacesUIUtils.openNodeWithEvent(target._placesNode, aEvent);
  },

  onPopupShowing: function BEH_onPopupShowing(aEvent) {
    var browser = getBrowser();
    if (!aEvent.currentTarget.parentNode._placesView)
      new PlacesMenu(aEvent, 'place:folder=BOOKMARKS_MENU');

    document.getElementById("Browser:BookmarkAllTabs")
            .setAttribute("disabled", !browser || browser.tabs.length == 1);
  },

  fillInBHTooltip: function BEH_fillInBHTooltip(aDocument, aEvent) {
    var node;
    var cropped = false;
    var targetURI;

    if (aDocument.tooltipNode.localName == "treechildren") {
      var tree = aDocument.tooltipNode.parentNode;
      var tbo = tree.treeBoxObject;
      var cell = tbo.getCellAt(aEvent.clientX, aEvent.clientY);
      if (cell.row == -1)
        return false;
      node = tree.view.nodeForTreeIndex(cell.row);
      cropped = tbo.isCellCropped(cell.row, cell.col);
    }
    else {
      // Check whether the tooltipNode is a Places node.
      // In such a case use it, otherwise check for targetURI attribute.
      var tooltipNode = aDocument.tooltipNode;
      if (tooltipNode._placesNode)
        node = tooltipNode._placesNode;
      else {
        // This is a static non-Places node.
        targetURI = tooltipNode.getAttribute("targetURI");
      }
    }

    if (!node && !targetURI)
      return false;

    // Show node.label as tooltip's title for non-Places nodes.
    var title = node ? node.title : tooltipNode.label;

    // Show URL only for Places URI-nodes or nodes with a targetURI attribute.
    var url;
    if (targetURI || PlacesUtils.nodeIsURI(node))
      url = targetURI || node.uri;

    // Show tooltip for containers only if their title is cropped.
    if (!cropped && !url)
      return false;

    var tooltipTitle = aDocument.getElementById("bhtTitleText");
    tooltipTitle.hidden = (!title || (title == url));
    if (!tooltipTitle.hidden)
      tooltipTitle.textContent = title;

    var tooltipUrl = aDocument.getElementById("bhtUrlText");
    tooltipUrl.hidden = !url;
    if (!tooltipUrl.hidden)
      tooltipUrl.value = url;

    // Show tooltip.
    return true;
  }
};


// Handles special drag and drop functionality for Places menus that are not
// part of a Places view (e.g. the bookmarks menu in the menubar).
var PlacesMenuDNDHandler = {
  _springLoadDelay: 350, // milliseconds
  _loadTimer: null,

  /**
   * Called when the user enters the <menu> element during a drag.
   * @param   event
   *          The DragEnter event that spawned the opening.
   */
  onDragEnter: function PMDH_onDragEnter(event) {
    // Opening menus in a Places popup is handled by the view itself.
    if (!this._isStaticContainer(event.target))
      return;

    this._loadTimer = Cc["@mozilla.org/timer;1"]
                        .createInstance(Ci.nsITimer);
    this._loadTimer.initWithCallback(function() {
      PlacesMenuDNDHandler._loadTimer = null;
      event.target.lastChild.setAttribute("autoopened", "true");
      event.target.lastChild.showPopup(event.target.lastChild);
    }, this._springLoadDelay, Ci.nsITimer.TYPE_ONE_SHOT);
    event.preventDefault();
    event.stopPropagation();
  },

  /**
   * Handles dragexit on the <menu> element.
   * @returns true if the element is a container element (menu or
   *          menu-toolbarbutton), false otherwise.
   */
  onDragExit: function PMDH_onDragExit(event) {
    // Closing menus in a Places popup is handled by the view itself.
    if (!this._isStaticContainer(event.target))
      return;

    if (this._loadTimer) {
      this._loadTimer.cancel();
      this._loadTimer = null;
    }
    let closeTimer = Cc["@mozilla.org/timer;1"]
                       .createInstance(Ci.nsITimer);
    closeTimer.initWithCallback(function() {
      let node = PlacesControllerDragHelper.currentDropTarget;
      let inHierarchy = false;
      while (node && !inHierarchy) {
        inHierarchy = node == event.target;
        node = node.parentNode;
      }
      if (!inHierarchy && event.target.lastChild &&
          event.target.lastChild.hasAttribute("autoopened")) {
        event.target.lastChild.removeAttribute("autoopened");
        event.target.lastChild.hidePopup();
      }
    }, this._springLoadDelay, Ci.nsITimer.TYPE_ONE_SHOT);
  },

  /**
   * Determines if a XUL element represents a static container.
   * @returns true if the element is a container element (menu or
   *          menu-toolbarbutton), false otherwise.
   */
  _isStaticContainer: function PMDH__isContainer(node) {
    let isMenu = node.localName == "menu" ||
                 (node.localName == "toolbarbutton" &&
                  node.getAttribute("type") == "menu");
    let isStatic = !("_placesNode" in node) && node.lastChild &&
                   node.lastChild.hasAttribute("placespopup") &&
                   !node.parentNode.hasAttribute("placespopup");
    return isMenu && isStatic;
  },

  /**
   * Called when the user drags over the <menu> element.
   * @param   event
   *          The DragOver event.
   */
  onDragOver: function PMDH_onDragOver(event) {
    let ip = new InsertionPoint(PlacesUtils.bookmarksMenuFolderId,
                                PlacesUtils.bookmarks.DEFAULT_INDEX,
                                Ci.nsITreeView.DROP_ON);
    if (ip && PlacesControllerDragHelper.canDrop(ip, event.dataTransfer))
      event.preventDefault();

    event.stopPropagation();
  },

  /**
   * Called when the user drops on the <menu> element.
   * @param   event
   *          The Drop event.
   */
  onDrop: function PMDH_onDrop(event) {
    // Put the item at the end of bookmark menu.
    let ip = new InsertionPoint(PlacesUtils.bookmarksMenuFolderId,
                                PlacesUtils.bookmarks.DEFAULT_INDEX,
                                Ci.nsITreeView.DROP_ON);
    PlacesControllerDragHelper.onDrop(ip, event.dataTransfer);
    event.stopPropagation();
  }
};


var BookmarkingUI = {
  _hasBookmarksObserver: false,
  _itemGuids: new Set(),

  uninit: function BUI_uninit()
  {
    if (this._hasBookmarksObserver) {
      PlacesUtils.bookmarks.removeObserver(this);
    }

    if (this._pendingUpdate) {
      delete this._pendingUpdate;
    }
  },

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsINavBookmarkObserver
  ]),

  get _starredTooltip()
  {
    delete this._starredTooltip;
    return this._starredTooltip =
      gNavigatorBundle.getString("starButtonOn.tooltip");
  },

  get _unstarredTooltip()
  {
    delete this._unstarredTooltip;
    return this._unstarredTooltip =
      gNavigatorBundle.getString("starButtonOff.tooltip");
  },

  updateStarState: function BUI_updateStarState() {
    this._uri = gBrowser.currentURI;
    this._itemGuids = [];
    let aItemGuids = [];

    // those objects are use to check if we are in the current iteration before
    // returning any result.
    let pendingUpdate = this._pendingUpdate = {};

    PlacesUtils.bookmarks.fetch({url: this._uri}, b => aItemGuids.push(b.guid))
      .catch(Cu..reportError)
      .then(() => {
         if (pendingUpdate != this._pendingUpdate) {
           return;
         }

         // It's possible that onItemAdded gets called before the async statement
         // calls back.  For such an edge case, retain all unique entries from the
         // array.
         this._itemGuids = this._itemGuids.filter(
           guid => !aItemGuids.includes(guid)
         ).concat(aItemGuids);

         this._updateStar();

         // Start observing bookmarks if needed.
         if (!this._hasBookmarksObserver) {
           try {
             PlacesUtils.bookmarks.addObserver(this);
             this._hasBookmarksObserver = true;
           } catch (ex) {
             Cu..reportError("BookmarkingUI failed adding a bookmarks observer: " + ex);
           }
         }

         delete this._pendingUpdate;
       });
  },

  _updateStar: function BUI__updateStar()
  {
    let starIcon = document.getElementById("star-button");
    if (this._itemGuids.length > 0) {
      starIcon.setAttribute("starred", "true");
      starIcon.setAttribute("tooltiptext", this._starredTooltip);
    }
    else {
      starIcon.removeAttribute("starred");
      starIcon.setAttribute("tooltiptext", this._unstarredTooltip);
    }
  },

  onClick: function BUI_onClick(aEvent)
  {
    // Ignore clicks on the star while we update its state.
    if (aEvent.button == 0 && !this._pendingUpdate)
      PlacesCommandHook.bookmarkCurrentPage(this._itemGuids.length > 0);
  },

  // nsINavBookmarkObserver
  onItemAdded(aItemId, aParentId, aIndex, aItemType, aURI, aTitle, aDateAdded, aGuid) {
    if (aURI && aURI.equals(this._uri)) {
      // If a new bookmark has been added to the tracked uri, register it.
      if (!this._itemGuids.includes(aGuid)) {
        this._itemGuids.push(aGuid);
        // Only need to update the UI if it wasn't marked as starred before:
        if (this._itemGuids.length == 1) {
          this._updateStar();
        }
      }
    }
  },

  onItemRemoved(aItemId, aParentId, aIndex, aItemType, aURI, aGuid) {
    let index = this._itemGuids.indexOf(aGuid);
    // If one of the tracked bookmarks has been removed, unregister it.
    if (index != -1) {
      this._itemGuids.splice(index, 1);
      // Only need to update the UI if the page is no longer starred
      if (this._itemGuids.length == 0) {
        this._updateStar();
      }
    }
  },

  onItemChanged(aItemId, aProperty, aIsAnnotationProperty, aNewValue, aLastModified,
                aItemType, aParentId, aGuid) {
    if (aProperty == "uri") {
      let index = this._itemGuids.indexOf(aGuid);
      // If the changed bookmark was tracked, check if it is now pointing to
      // a different uri and unregister it.
      if (index != -1 && aNewValue != this._uri.spec) {
        this._itemGuids.splice(index, 1);
        // Only need to update the UI if the page is no longer starred
        if (this._itemGuids.length == 0) {
          this._updateStar();
        }
      } else if (index == -1 && aNewValue == this._uri.spec) {
        // If another bookmark is now pointing to the tracked uri, register it.
        this._itemGuids.push(aGuid);
        // Only need to update the UI if it wasn't marked as starred before:
        if (this._itemGuids.length == 1) {
          this._updateStar();
        }
      }
    }
  },

  onBeginUpdateBatch: function () {},
  onEndUpdateBatch: function () {},
  onItemVisited: function () {},
  onItemMoved: function () {}
};


// This object handles the initialization and uninitialization of the bookmarks
// toolbar.  updateStarState is called when the browser window is opened and
// after closing the toolbar customization dialog.
var PlacesToolbarHelper = {
  _place: "place:folder=TOOLBAR",
  get _viewElt() {
    return document.getElementById("PlacesToolbar");
  },

  init: function PTH_init() {
    let viewElt = this._viewElt;
    if (!viewElt || viewElt._placesView)
      return;

    // There is no need to initialize the toolbar if customizing because
    // init() will be called when the customization is done.
    if (this._isCustomizing)
      return;

    new PlacesToolbar(this._place);
  },

  customizeStart: function PTH_customizeStart() {
    let viewElt = this._viewElt;
    if (viewElt && viewElt._placesView)
      viewElt._placesView.uninit();

    this._isCustomizing = true;
  },

  customizeDone: function PTH_customizeDone() {
    this._isCustomizing = false;
    this.init();
  }
};


// Handles the bookmarks menu popup
var BookmarksMenu = {
  _popupInitialized: {},
  onPopupShowing: function BM_onPopupShowing(aEvent, aPrefix) {
    if (!(aPrefix in this._popupInitialized)) {
      // First popupshowing event, initialize immutable attributes.
      this._popupInitialized[aPrefix] = true;

      // Need to set the label on Unsorted Bookmarks menu.
      let unsortedBookmarksElt =
        document.getElementById(aPrefix + "unsortedBookmarksFolderMenu");
      unsortedBookmarksElt.label =
        PlacesUtils.getString("OtherBookmarksFolderTitle");
    }
  },
};
