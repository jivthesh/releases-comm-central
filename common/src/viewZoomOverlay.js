// -*- indent-tabs-mode: nil; js-indent-level: 2 -*-

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals getBrowser */

/** Document Zoom Management Code
 *
 * Forked from M-C since we don't provide a global gBrowser variable.
 **/

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

var ZoomManager = {
  get MIN() {
    delete this.MIN;
    return (this.MIN = Services.prefs.getIntPref("zoom.minPercent") / 100);
  },

  get MAX() {
    delete this.MAX;
    return (this.MAX = Services.prefs.getIntPref("zoom.maxPercent") / 100);
  },

  get useFullZoom() {
    return Services.prefs.getBoolPref("browser.zoom.full");
  },

  set useFullZoom(aVal) {
    Services.prefs.setBoolPref("browser.zoom.full", aVal);
    return aVal;
  },

  get zoom() {
    return this.getZoomForBrowser(getBrowser());
  },

  getZoomForBrowser(aBrowser) {
    let zoom =
      this.useFullZoom || aBrowser.isSyntheticDocument
        ? aBrowser.fullZoom
        : aBrowser.textZoom;
    // Round to remove any floating-point error.
    return Number(zoom ? zoom.toFixed(2) : 1);
  },

  set zoom(aVal) {
    this.setZoomForBrowser(getBrowser(), aVal);
    return aVal;
  },

  setZoomForBrowser(aBrowser, aVal) {
    if (aVal < this.MIN || aVal > this.MAX) {
      throw Components.Exception("", Cr.NS_ERROR_INVALID_ARG);
    }

    if (this.useFullZoom || aBrowser.isSyntheticDocument) {
      aBrowser.textZoom = 1;
      aBrowser.fullZoom = aVal;
    } else {
      aBrowser.textZoom = aVal;
      aBrowser.fullZoom = 1;
    }
  },

  get zoomValues() {
    var zoomValues = Services.prefs
      .getCharPref("toolkit.zoomManager.zoomValues")
      .split(",")
      .map(parseFloat);
    zoomValues.sort((a, b) => a - b);

    while (zoomValues[0] < this.MIN) {
      zoomValues.shift();
    }

    while (zoomValues[zoomValues.length - 1] > this.MAX) {
      zoomValues.pop();
    }

    delete this.zoomValues;
    return (this.zoomValues = zoomValues);
  },

  enlarge() {
    var i = this.zoomValues.indexOf(this.snap(this.zoom)) + 1;
    if (i < this.zoomValues.length) {
      this.zoom = this.zoomValues[i];
    }
  },

  reduce() {
    var i = this.zoomValues.indexOf(this.snap(this.zoom)) - 1;
    if (i >= 0) {
      this.zoom = this.zoomValues[i];
    }
  },

  reset() {
    this.zoom = 1;
  },

  toggleZoom() {
    var zoomLevel = this.zoom;

    this.useFullZoom = !this.useFullZoom;
    this.zoom = zoomLevel;
  },

  snap(aVal) {
    var values = this.zoomValues;
    for (var i = 0; i < values.length; i++) {
      if (values[i] >= aVal) {
        if (i > 0 && aVal - values[i - 1] < values[i] - aVal) {
          i--;
        }
        return values[i];
      }
    }
    return values[i - 1];
  },
};