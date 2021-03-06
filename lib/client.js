"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = require("axios");
const querystring = require("querystring");
const _debug = require("debug");
const lib_1 = require("./lib");
const debug = _debug("smart");
/**
 * A SMART Client instance will simplify some tasks for you. It will authorize
 * requests automatically, use refresh tokens, handle errors and so on.
 */
class Client {
    constructor(state) {
        // This might happen if the state have been lost (for example the server
        // was restarted and a memory storage was used).
        if (!state) {
            throw new Error("No state provided to the client");
        }
        this.state = state;
    }
    /**
     * Allows you to do the following:
     * 1. Use relative URLs (treat them as relative to the "serverUrl" option)
     * 2. Automatically authorize requests with your accessToken (if any)
     * 3. Automatically re-authorize using the refreshToken (if available)
     * 4. Automatically parse error operation outcomes and turn them into
     *   JavaScript Error objects with which the resulting promises are rejected
     * @param {object|string} options URL or axios request options
     */
    async request(options = {}) {
        if (typeof options == "string") {
            options = { url: options };
        }
        options.baseURL = this.state.serverUrl.replace(/\/?$/, "/");
        const accessToken = lib_1.getPath(this.state, "tokenResponse.access_token");
        if (accessToken) {
            options.headers = Object.assign({}, options.headers, { Authorization: `Bearer ${accessToken}` });
        }
        return axios_1.default(options).catch(error => {
            // The request was made and the server responded with a
            // status code that falls out of the range of 2xx
            if (error.response) {
                if (error.response.status == 401) {
                    debug("401 received");
                    if (lib_1.getPath(this.state, "tokenResponse.refresh_token")) {
                        debug("Refreshing using the refresh token");
                        return this.refresh().then(() => this.request(options));
                    }
                }
                const resourceType = lib_1.getPath(error, "response.data.resourceType");
                const issues = lib_1.getPath(error, "response.data.issue");
                const body = error.response.data;
                if (resourceType == "OperationOutcome" && issues.length) {
                    debug("OperationOutcome error response detected");
                    const errors = body.issue.map((o) => `${o.severity} ${o.code} ${o.diagnostics}`);
                    throw new Error(errors.join("\n"));
                }
                throw error;
            }
            // The request was made but no response was received
            // "error.request" is an instance of http.ClientRequest
            throw new Error(lib_1.getErrorText("no_fhir_response"));
        });
    }
    /**
     * Use the refresh token to obtain new access token.
     * If the refresh token is expired it will be deleted from the state, so
     * that we don't enter into loops trying to re-authorize.
     */
    async refresh() {
        if (!this.state.tokenResponse || !this.state.tokenResponse.refresh_token) {
            throw new Error("Trying to refresh but there is no refresh token");
        }
        const refreshToken = lib_1.getPath(this.state, "tokenResponse.refresh_token");
        return axios_1.default({
            method: "POST",
            url: this.state.tokenUri,
            headers: {
                "content-type": "application/x-www-form-urlencoded"
            },
            data: querystring.stringify({
                grant_type: "refresh_token",
                refresh_token: refreshToken
            })
        }).then(({ data }) => {
            this.state.tokenResponse = Object.assign({}, this.state.tokenResponse, data);
            return data;
        })
            .catch(error => {
            if (error.response && error.response.status == 401) {
                debug("401 received - refresh token expired or invalid");
                debug("Deleting the expired or invalid refresh token");
                delete this.state.tokenResponse.refresh_token;
            }
            throw error;
        });
    }
}
exports.default = Client;
