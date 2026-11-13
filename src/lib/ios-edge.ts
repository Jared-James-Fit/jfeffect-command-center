/**
 * The iPhone home-screen app (Safari's "Add to Home Screen", `navigator.standalone`).
 *
 * Its status bar is solid (`apple-mobile-web-app-status-bar-style` "default",
 * __root.tsx): the app starts right under the clock, with nothing drawn under
 * the status bar, so there's nothing for iOS to blur and no gap above the bars,
 * the way a native app sits. The bar takes the page's own colour (`theme-color`,
 * THEME_COLOR in theme.ts; black over Crew's paged feed).
 *
 * iOS reads that setting only when the app is added to the Home Screen, so an
 * app added before it still draws under a transparent status bar
 * ("black-translucent"), and from iOS 26.1 iOS lays its own blur from the notch
 * down to about 40pt under it over whatever is there, fixed opaque bars included
 * (measured on the coach's iPhone: the bar's logo and icons at 72–96pt read
 * blurred, everything from ~100pt sharp). There, and only there (the page is
 * under the clock: env(safe-area-inset-top) > 0), every top bar starts
 * IOS_EDGE_ROOM lower (`--ios-edge-room`, added into `--app-safe-top` and
 * `--focus-top`), and the blurred band only ever holds the background. Deleting
 * the app and adding it again from Safari gives it the solid status bar. The
 * native app turns the effect off itself (ios-build.yml), and other browsers
 * don't draw it.
 *
 * Marked before the first paint (an inline <head> script), so nothing moves. It
 * also measures the window's height (`--app-vh`): with a solid status bar iOS's
 * 100vh counts the status bar too (WebKit 316008), which would leave every page
 * scrollable by that much.
 */
export const IOS_EDGE_ROOM = "28px";

export const IOS_WEB_APP_BOOT_SCRIPT =
  '(function(){try{if(window.navigator.standalone===true){var r=document.documentElement;r.setAttribute("data-ios-web-app","");var w=window.innerWidth,s=function(){r.style.setProperty("--app-vh",window.innerHeight+"px")};s();window.addEventListener("resize",function(){if(window.innerWidth!==w){w=window.innerWidth;s()}})}}catch(e){}})();';
