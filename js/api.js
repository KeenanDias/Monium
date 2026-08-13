/* ------------------------------------------------------------------
   Monium API client — AWS backend (API Gateway + Lambda).

   Everything money-related goes through here. Auth is the monium-auth
   Lambda; the session (userId + JWT) lives in localStorage and is sent
   as a Bearer token on every authenticated call.

   userId is always read from the stored session, never passed in by a
   caller — so no UI code can address another user's record.

   Load order on app.html:
     1) js/config.js
     2) js/api.js   <-- this file
   ------------------------------------------------------------------ */
(function () {
  var BASE = "https://z2t5gxylo8.execute-api.us-east-1.amazonaws.com/prod";
  var KEY = "monium.session";

  var session = {
    get: function () {
      try {
        return JSON.parse(localStorage.getItem(KEY) || "null");
      } catch (e) {
        return null;
      }
    },
    set: function (s) {
      localStorage.setItem(KEY, JSON.stringify(s));
    },
    clear: function () {
      localStorage.removeItem(KEY);
    },
    userId: function () {
      var s = session.get();
      return s && s.userId;
    }
  };

  async function post(path, body, authenticated) {
    var s = session.get();

    if (authenticated !== false && !s) {
      throw new Error("Not signed in");
    }

    var headers = { "Content-Type": "application/json" };
    if (authenticated !== false && s) {
      headers.Authorization = "Bearer " + s.token;
    }

    var res;
    try {
      res = await fetch(BASE + path, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body)
      });
    } catch (e) {
      // fetch only rejects on network failure - a CORS block lands here too
      throw new Error("Can't reach Monium. Check your connection and try again.");
    }

    var data = {};
    try {
      data = await res.json();
    } catch (e) {
      /* empty body */
    }

    // Tokens last 24h; once one expires the only cure is a fresh sign-in
    if (res.status === 401 || res.status === 403) {
      session.clear();
      throw new Error("Your session expired. Please sign in again.");
    }

    if (!res.ok) {
      throw new Error(data.error || "Something went wrong (" + res.status + ")");
    }

    return data;
  }

  async function authenticate(email, password, action) {
    var r = await post("/auth", { email: email, password: password, action: action }, false);
    session.set({ userId: r.userId, email: r.email, token: r.token });
    return r;
  }

  window.MONIUM_API = {
    session: session,
    isSignedIn: function () {
      return !!session.get();
    },

    register: function (email, password) {
      return authenticate(email, password, "register");
    },
    login: function (email, password) {
      return authenticate(email, password, "login");
    },
    logout: function () {
      session.clear();
    },

    // profile fields the onboarding form collects
    saveProfile: function (profile) {
      return post("/kyc", Object.assign({ userId: session.userId() }, profile));
    },

    // Plaid: link token -> user picks a bank -> exchange -> refresh
    linkToken: function () {
      return post("/plaid", { userId: session.userId() });
    },
    exchange: function (publicToken) {
      return post("/plaid-exchange", {
        userId: session.userId(),
        publicToken: publicToken
      });
    },

    // Recomputes safe-to-spend from the latest Plaid data
    refresh: function () {
      return post("/process-transactions", { userId: session.userId() });
    },

    // Opens Plaid Link and runs the whole connect flow through to fresh numbers.
    // Resolves with the safe-to-spend payload, or null if the user backed out.
    connectBank: async function () {
      if (typeof Plaid === "undefined") {
        throw new Error("Plaid Link failed to load. Check your connection.");
      }

      var tokenResponse = await window.MONIUM_API.linkToken();

      return new Promise(function (resolve, reject) {
        var handler = Plaid.create({
          token: tokenResponse.link_token,
          onSuccess: async function (publicToken) {
            try {
              await window.MONIUM_API.exchange(publicToken);
              resolve(await window.MONIUM_API.refresh());
            } catch (e) {
              reject(e);
            }
          },
          onExit: function (err) {
            // No error means the user simply closed Link - not a failure
            if (err) reject(new Error(err.display_message || err.error_message || "Bank connection cancelled."));
            else resolve(null);
          }
        });

        handler.open();
      });
    }
  };
})();
