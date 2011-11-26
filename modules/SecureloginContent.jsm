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
 * The Original Code is Secure Login In-Content Module.
 *
 * The Initial Developer of the Original Code is
 * saneyuki_s
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   saneyuki_s <saneyuki.snyk@gmail.com> (original author)
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
var EXPORTED_SYMBOLS = ["SecureloginContent"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://securelogin/SecureloginService.jsm");

function SecureloginContent (aGlobal) {
	this.initialize(aGlobal);
}
SecureloginContent.prototype = {

	QueryInterface: XPCOMUtils.generateQI([Ci.nsIDOMEventListener,
	                                       Ci.nsIObserver,
	                                       Ci.nsISupportsWeakReference,
	                                       Ci.nsISupports]),

	global             : null,
	_secureLoginInfoMap: null,

	get secureLoginInfoMap () {
		if (!this._secureLoginInfoMap) {
			this._secureLoginInfoMap = new WeakMap();
		}
		return this._secureLoginInfoMap;
	},

	initialize: function (aGlobal) {
		this.global = aGlobal;
		Services.obs.addObserver(this, "Securelogin", true);
	},

	destroy: function () {
		Services.obs.removeObserver(this, "Securelogin");
		this.global = null;
	},

	/*
	 * Search login data in the given window.
	 * @param {Window} aWindow
	 */
	searchLogin: function (aBrowser, aWindow) {
		let window   = aWindow;
		let document = window.document;
		let forms    = document.forms;
		if (forms && forms.length > 0) {

			// Get an array of nsILoginInfo which are related to the document.
			let matchData = this._createMatchdata(document.documentURI);
			let savedLogins = Services.logins.searchLogins({}, matchData);

			if (savedLogins.length > 0) {
				let infosArray = [];
				for (let i = 0, l = savedLogins.length; i < l; i++) {
					let info = this.searchLoginInForm(savedLogins[i], forms);
					if (info != null) {
						infosArray.push(info);
					}
				}

				if (infosArray.length > 0) {
					// Store the array of founded SecureLoginInfo.
					this.secureLoginInfoMap.set(aBrowser, infosArray);

					// Pass the array of username to UI parts.
					let usernames = infosArray.map(function(elem){
						return elem.username;
					});
					this.notifyObserver("loginFound", { contentWindow : aWindow,
					                                    browser       : aBrowser,
					                                    logins        : usernames });
				}

			}
		}
	},

	/*
	 * @param   {string} aLoginInfo
	 * @returns {nsIPropertyBag}
	 */
	_createMatchdata: function (aURL) {
		let origin = SecureloginService.createNsIURI(aURL, null, null).prePath;
		let matchData = Cc["@mozilla.org/hash-property-bag;1"]
		                .createInstance(Ci.nsIWritablePropertyBag);
		matchData.setProperty("hostname", origin);

		return matchData;
	},

	/*
	 * @param   {nsILoginInfo}    aLoginInfo
	 * @param   {HTMLCollection}  aForms
	 * @returns {SecureLoginInfo}
	 */
	searchLoginInForm: function (aLoginInfo, aForms) {
		let info = null;
		for (let i = 0, l = aForms.length; i < l; i++) {
			let form = aForms[i];
			let documentURI = form.ownerDocument.documentURI;

			let formActionURI = SecureloginService.createNsIURI(form.action, null, documentURI);//nsIURI

			let isSameURL = (aLoginInfo.formSubmitURL == formActionURI.prePath);

			if (isSameURL) {
				info = this.findLoginElements(aLoginInfo, formActionURI.spec, form);
				if (info != null) {
					break;
				}
			}
			else {
				continue;
			}
		}
		return info;
	},

	/*
	 * @param   {nsILoginInfo}    aLoginInfo
	 * @param   {string}          aFormActionURI
	 * @param   {HTMLFormElement} aForm
	 * @returns {SecureLoginInfo}
	 */
	findLoginElements: function (aLoginInfo, aFormActionURI, aForm) {
		let loginInfo = null;
		let [user, pass] = this._getLoginElements(aLoginInfo, aForm);
		if (pass) {
			loginInfo = new SecureLoginInfo(aLoginInfo, aFormActionURI, aForm);
			this.highlightForm(user, pass);
		}
		return loginInfo;
	},

	/*
	 * @param   {nsILoginInfo}     aLoginInfo
	 * @param   {HTMLFormElement}  aForm
	 * @returns {Array}            Destructuring assignment.
	 *          {HTMLInputElement} the username input field.
	 *          {HTMLInputElement} the username password field.
	 */
	_getLoginElements: function (aLoginInfo, aForm) {
		let [user, pass] = [null, null];
		let elements = aForm.elements;

		user = elements.namedItem(aLoginInfo.usernameField);

		pass = elements.namedItem(aLoginInfo.passwordField);
		if (pass && pass.type != "password") {
			pass = null;
		}

		return [user, pass];
	},

	/*
	 * @param {Element} aUserField
	 * @param {Element} aPassField
	 */
	highlightForm: function (aUserField, aPassField) {
		if (aUserField) {
			this.highlightElement(aUserField);
		}

		if (aPassField) {
			this.highlightElement(aPassField);
		}
	},

	/*
	 * @param {Element} aElement
	 */
	highlightElement: function (aElement) {
		let style = aElement.style;
	},

	/*
	 * @param {string} aData
	 * @param {object} aSubject
	 */
	notifyObserver: function (aData, aSubject) {
		aSubject.chromeWindow = this.global;
		let subject = { wrappedJSObject: aSubject };
		Services.obs.notifyObservers(subject, "Securelogin", aData);
	},

	/*
	 * @param {XULElement} aBrowser
	 *        The browser for login.
	 * @param {string} aLoginDataId
	 *        The identifier of login data to login.
	 *        This parameter is based on an username.
	 */
	login: function (aBrowser, aLoginDataId) {
		let info = this.getSecureLoginInfo(aBrowser, aLoginDataId);
		if (!info) {
			return Cu.reportError("");
		}

		if (SecureloginService.useProtection()) {
			this._loginWithProtection(aBrowser, info);
		}
		else {
			this._loginWithNormal(info);
		}
	},

	getSecureLoginInfo: function (aBrowser, aLoginDataId) {
		let loginInfo = null;
		let infos = this.secureLoginInfoMap.get(aBrowser);
		if (aLoginDataId && infos && infos.length > 0) {
			let login = infos.filter(function(elm){
				return (elm.username == aLoginDataId);
			});
			loginInfo = login[0];
		}
		return loginInfo;
	},

	/*
	 * @param {XULElement}      aBrowser
	 * @param {SecureLoginInfo} aLoginInfo
	 */
	_loginWithProtection: function (aBrowser, aLoginInfo) {
		let dataString = this._createDataString(aLoginInfo);
		let referrer = SecureloginService.createNsIURI(aLoginInfo.form.baseURI);

		this._sendLoginDataWithProtection(aBrowser,
		                                  aLoginInfo.formMethod,
		                                  aLoginInfo.formActionURI,
		                                  dataString,
		                                  referrer);
	},

	/*
	 * @param   {SecureLoginInfo} aLoginInfo
	 * @returns {string}
	 */
	_createDataString: function (aLoginInfo) {
		let param    = [];
		let elements = aLoginInfo.form.elements;
		let charset  = aLoginInfo.charset;

		let setDataString = function setDataString (aKey, aValue) {
			let data = SecureloginService.encodeString(aKey, charset) +
			           "=" +
			           SecureloginService.encodeString(aValue, charset);
			param.push(data);
		};

		// Set key & value.
		for (let i = 0, l = elements.length; i < l; i++) {
			let element = elements[i];
			switch (element.type) {
				case "checkbox":
				case "radio":
					/*
					 * NOTE:
					 * W3C HTML5 specification,
					 * 4.10.22.4 Constructing the form data set, 3.1.
					 * <http://www.w3.org/TR/html5/association-of-controls-and-forms.html>
					 *
					 * Skip an |input| element whose type is |checkbox| or |radio|,
					 * and it is not checked.
					 */
					if (element.checked) {
						setDataString(element.name, element.value);
					}
					break;
				case "password":
					if (element.name == aLoginInfo.passwordField) {
						setDataString(aLoginInfo.passwordField, aLoginInfo.password);
					}
					break;
				case "submit":
					/*
					 * The current interface of nsILoginInfo does not have an identifier 
					 * for submit button.
					 * This part is disable so it can't be helped.
					 * If it needs to set submit button's value,
					 * this part might be implemented to regard first submit button in the form
					 * as the "login" button.
					 */
					break;
				default:
					if (element.name == aLoginInfo.usernameField) {
						setDataString(aLoginInfo.usernameField, aLoginInfo.username);
					}
					else {
						setDataString(element.name, element.value);
					}
					break;
			}
		}

		return param.join("&");
	},

	/*
	 * @param {XULElement} aBrowser
	 * @param {string}     aFormMethod
	 * @param {string}     aUrl
	 * @param {string}     aDataStr
	 * @param {nsIURI}     aReferrer
	 */
	_sendLoginDataWithProtection: function (aBrowser, aFormMethod, aUrl, aDataStr, aReferrer) {
		let method = aFormMethod.toUpperCase();
		if (method === "POST") {
			// Create post data mime stream. (params: aStringData, aKeyword, aEncKeyword, aType)
			let postData = this.global.getPostDataStream(aDataStr, "", "", "application/x-www-form-urlencoded");
			// Load the url in the browser.
			this._loadURI(aBrowser, aUrl, aReferrer, postData);
		}
		else if (method === "GET") {
			// Remove existing parameters & add the parameter list to the uri.
			let index = aUrl.indexOf("?");
			if (index === -1) {
				aUrl += "?" + aDataStr;
			}
			else {
				aUrl = aUrl.substring(0, index + 1) + aDataStr;
			}
			// Load the uri in the browser.
			this._loadURI(aBrowser, aUrl, aReferrer, null);
		}
		else {
			let message = "Failed Login. HTTP " + method + " method is not supported by Secure Login";
			Cu.reportError(message);
		}
	},

	/*
	 * @param {XULElement}     aBrowser
	 * @param {string}         aUrl
	 * @param {nsIURI}         aReferrer
	 * @param {nsIInputStream} aPostData
	 */
	_loadURI: function (aBrowser, aUrl, aReferrer, aPostData) {
		if (aPostData === undefined) {
			aPostData = null;
		}

		let flags = Ci.nsIWebNavigation.LOAD_FLAGS_NONE;
		try {
			aBrowser.loadURIWithFlags(aUrl, flags, aReferrer, null, aPostData);
		}
		catch (e) {
			Cu.reportError(e);
		}
	},

	/*
	 * @param {SecureLoginInfo} aLoginInfo
	 */
	_loginWithNormal: function (aLoginInfo) {
		let form     = aLoginInfo.form;
		let elements = form.elements;
		let submitButton = null;
		for (let i = 0, l = elements.length; i < l; i++) {
			let element = elements[i];
			switch (element.type) {
				case "password":
					break;
				case "submit":
					break;
			}
		}
		
	},

	/* EventListner */
	handleEvent: function (aEvent) {
		switch (aEvent.type) {
		}
	},

	/* nsIObserver */
	observe: function (aSubject, aTopic, aData) {
		if (aTopic == "Securelogin") {
			let message = aSubject.wrappedJSObject;
			let chromeWindow = message.chromeWindow;
			switch (aData) {
				case "searchLogin":
					if (this.global == chromeWindow) {
						this.searchLogin(message.browser, message.contentWindow);
					}
					break;
				case "login":
					if (this.global == chromeWindow) {
						this.login(message.browser, message.loginId);
					}
					break;
			}
		}
	},

};

/*
 * @param {nsILoginInfo}    aLoginInfo
 * @param {string}          aFormActionURI
 * @param {HTMLFormElement} aForm
 */
function SecureLoginInfo (aLoginInfo, aFormActionURI, aForm) {
	this.nsILoginInfo  = aLoginInfo;
	this.formActionURI = aFormActionURI;
	this.form          = aForm;
	this.formMethod    = aForm.method;
}
SecureLoginInfo.prototype = {
	nsILoginInfo : null, // nsILoginInfo
	formActionURI: null, // string
	formMethod   : null, // string
	form         : null, // HTMLFormElement

	get username () {
		return this.nsILoginInfo.username;
	},

	/*
	 * The |name| attribute for the username input field.
	 *
	 * @returns {string}
	 */
	get usernameField () {
		return this.nsILoginInfo.usernameField;
	},

	get password () {
		return this.nsILoginInfo.password;
	},

	/*
	 * The |name| attribute for the password input field.
	 *
	 * @returns {string}
	 */
	get passwordField () {
		return this.nsILoginInfo.passwordField;
	},

	/*
	 * The character encoding of the document which has the form.
	 *
	 * @returns {string}
	 */
	get charset () {
		return this.form.ownerDocument.characterSet;
	},

};