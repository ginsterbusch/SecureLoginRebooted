/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let EXPORTED_SYMBOLS = ["SecureloginChrome"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://securelogin/SecureloginService.jsm");

const DOORHANGER_NOTIFICATION_ID = "securelogin-loginFound";
const DOORHANGER_ANCHOR_ID       = "securelogin-notification-icon";

function SecureloginChrome (aChromeWindow) {
	this.initialize(aChromeWindow);
}
SecureloginChrome.prototype = {

	QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
	                                       Ci.nsIDOMEventListener,
	                                       Ci.nsISupportsWeakReference,
	                                       Ci.nsISupports]),

	window: null,

	get secureLoginInfoMap () {
		let map = new WeakMap();
		Object.defineProperty(this, "secureLoginInfoMap", {
			value       : map,
			writable    : true,
			configurable: true,
			enumerable  : true,
		});
		return map;
	},

	initialize: function (aChromeWindow) {
		this.window = aChromeWindow;

		aChromeWindow.addEventListener("load", this, false);
		SecureloginService.addObserver(this);
	},

	destroy: function () {
		SecureloginService.removeObserver(this);
		this.window = null;
	},

	onLoginFound: function (aMessage) {
		let browser = aMessage.browser;
		this.secureLoginInfoMap.set(browser, {
			logins  : aMessage.logins,
			location: browser.currentURI,
		});
		this.showNotification(browser);
	},

	showNotification: function (aBrowser) {
		let that = this;
		let GetStringFromName = SecureloginService.stringBundle.GetStringFromName;

		let mainAction = {
			label    : GetStringFromName("doorhanger.login.label"),
			accessKey: GetStringFromName("doorhanger.login.accesskey"),
			callback : function () {
				that.loginSelectedBrowser();
			},
		};

		let switchLoginModeAction = {
			label    : GetStringFromName("doorhanger.switchLoginMode.label"),
			accessKey: GetStringFromName("doorhanger.switchLoginMode.accesskey"),
			callback : function () {
				that.switchLoginModeConfig();
			},
		};

		this.window.PopupNotifications.show(
			aBrowser,
			DOORHANGER_NOTIFICATION_ID,
			GetStringFromName("doorhanger.description"),
			DOORHANGER_ANCHOR_ID,
			mainAction,
			[switchLoginModeAction],
			{
				persistence        : 0,
				timeout            : null,
				persistWhileVisible: false,
				dismissed          : true,
				eventCallback      : null,
				neverShow          : false,
			 }
		);
	},

	loginSelectedBrowser: function () {
		let browser = this.window.gBrowser.selectedBrowser;
		this.login(browser);
	},

	login: function (aBrowser) {
		let secureLoginInfoMap = this.secureLoginInfoMap;
		if (!secureLoginInfoMap.has(aBrowser)) {
			return;
		}

		let loginInfo = secureLoginInfoMap.get(aBrowser);
		if (loginInfo.location.equals(aBrowser.currentURI)) { 
			let loginId = this.getLoginId(loginInfo);
			this.notifyObservers("login", { browser: aBrowser, 
			                                loginId: loginId });
		}
	},

	getLoginId: function (aLoginInfo) {
		let loginId = "";
		let logins  = aLoginInfo.logins;
		if (logins) {
			if (logins.length > 1) {
				loginId = this._selectLoginId(logins);
			}
			else {
				loginId = logins[0];
			}
		}
		return loginId;
	},

	_selectLoginId: function (aLoginsArray) {
		let loginId  = null;
		let selected = {};

		let stringBundle = SecureloginService.stringBundle;
		let title = stringBundle.GetStringFromName("prompt.selectLoginId.title");
		let description = stringBundle.GetStringFromName("prompt.selectLoginId.description");

		let result   = Services.prompt.select(this.window,
		                                      title,
		                                      description,
		                                      aLoginsArray.length,
		                                      aLoginsArray,
		                                      selected);
		if (result) {
			loginId = aLoginsArray[selected.value];
		}
		return loginId;
	},

	switchLoginModeConfig: function () {
		let uri = this.window.gBrowser.selectedBrowser.currentURI;

		let stringBundle = SecureloginService.stringBundle;
		let title = stringBundle.GetStringFromName("prompt.switchLoginModeConfig.title");
		let description = stringBundle.GetStringFromName("prompt.switchLoginModeConfig.description");
		let useNormal = Services.prompt.confirm(this.window, title, description);

		SecureloginService.setLoginMode(uri, !useNormal);
	},

	updateOnProgress: function (aBrowser, aContentWindow) {
		this.notifyObservers("searchLogin", { contentWindow: aContentWindow,
		                                     browser      : aBrowser });
	},

	notifyObservers: function (aData, aSubject) {
		SecureloginService.notifyObservers(this.window, aData, aSubject);
	},

	/* nsIObserver */
	observe: function (aSubject, aTopic, aData) {
		if (aTopic === SecureloginService.OBSERVER_TOPIC) {
			let message = aSubject.wrappedJSObject;
			switch (aData) {
				case "loginFound":
					if (this.window === message.chromeWindow) {
						this.onLoginFound(message);
					}
					break;
			}
		}
	},

	/* EventListner */
	handleEvent: function (aEvent) {
		switch (aEvent.type) {
			case "load":
				this.onLoad(aEvent);
				break;
			case "unload":
				this.onUnload(aEvent);
				break;
			case "TabOpen":
				this.onTabOpen(aEvent);
				break;
			case "TabClose":
				this.onTabClose(aEvent);
				break;
			case "DOMContentLoaded":
				this.onDOMLoaded(aEvent);
				break;
		}
	},

	onLoad: function (aEvent) {
		let window = this.window;
		let gBrowser = window.gBrowser;
		window.removeEventListener("load", this);

		gBrowser.tabContainer.addEventListener("TabOpen", this, false);
		gBrowser.tabContainer.addEventListener("TabClose", this, false);
		gBrowser.addTabsProgressListener(this);

		// Add event listener to xul:browser element,
		// because TabOpen event is not fired when opens browser window.
		let tabs = gBrowser.tabContainer.childNodes;
		for (let tab of tabs) {
			let browser = gBrowser.getBrowserForTab(tab);
			browser.addEventListener("DOMContentLoaded", this, true, true);
		}

		window.addEventListener("unload", this, false);
	},

	onUnload: function (aEvent) {
		let window = this.window;
		let gBrowser = window.gBrowser;
		window.removeEventListener("unload", this);

		gBrowser.removeTabsProgressListener(this);
		gBrowser.tabContainer.removeEventListener("TabClose", this, false);
		gBrowser.tabContainer.removeEventListener("TabOpen", this, false);

		// Remove event listener from xul:browser element,
		// because TabClose event is not fired when closes browser window.
		let tabs = gBrowser.tabContainer.childNodes;
		for (let tab of tabs) {
			let browser = gBrowser.getBrowserForTab(tab);
			browser.removeEventListener("DOMContentLoaded", this, true);
		}

		this.destroy();
	},

	onTabOpen: function (aEvent) {
		let browser = this.window.gBrowser.getBrowserForTab(aEvent.target);
		browser.addEventListener("DOMContentLoaded", this, true, true);
	},

	onTabClose: function (aEvent) {
		let browser = this.window.gBrowser.getBrowserForTab(aEvent.target);
		browser.removeEventListener("DOMContentLoaded", this, true);
	},

	onDOMLoaded: function (aEvent) {
		let browser       = aEvent.currentTarget;
		let contentWindow = browser.contentWindow;

		// Call only if a DOMContentLoaded fires from the root document.
		if (aEvent.target === contentWindow.document) {
			this.updateOnProgress(browser, contentWindow);
		}
	},

	/* ProgressListener */
	onStateChange: function (aBrowser, aWebProgress, aRequest, aStateFlags, aStatus) {
		// Fastback (e.g. restore the tab) doesn't fire DOMContentLoaded.
		if ((aStateFlags & Ci.nsIWebProgressListener.STATE_RESTORING)) {
			let isSTATE_STOP = (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP);
			if (isSTATE_STOP) {
				this.updateOnProgress(aBrowser, aWebProgress.DOMWindow);
			}
		}
	},

};