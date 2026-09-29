// PostHog for the landing page (pageviews, autocapture, uncaught errors). It
// loads only once the visitor has accepted cookies (heypay_cookie_consent =
// "accepted"), so a visitor who declines or ignores the banner sends nothing. The project key is
// public by design; it is the same one the app bundles as NEXT_PUBLIC_POSTHOG_KEY.
(function () {
  var KEY = "phc_xFnfWRiZB8whzbvSsfWo6xrWEdwhTRwhDu8Whgkjg3rw";
  var CONSENT = "heypay_cookie_consent";

  function load() {
    if (window.posthog && window.posthog.__SV) return;
    // Official PostHog loader stub: queues calls until array.js arrives.
    // prettier-ignore
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags on onFeatureFlags onSessionId identify setPersonProperties group resetGroups reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    window.posthog.init(KEY, {
      api_host: "https://us.i.posthog.com",
      ui_host: "https://us.posthog.com",
      defaults: "2026-08-30",
      person_profiles: "identified_only",
      capture_exceptions: true,
    });
  }

  window.heypayAnalytics = { load: load };

  try {
    if (localStorage.getItem(CONSENT) === "accepted") load();
  } catch {
    // Storage blocked (private mode): treat as no consent.
  }
})();
