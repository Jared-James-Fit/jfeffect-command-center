/**
 * The iPhone home-screen app (Safari's "Add to Home Screen", `navigator.standalone`):
 * iOS 26 fades its own blur from the notch down to about 40pt under it, over
 * whatever web content is there, fixed opaque bars included (measured on the
 * coach's iPhone: the bar's logo and icons at 72–96pt read blurred, everything
 * from ~100pt sharp). So there, every top bar starts IOS_EDGE_ROOM lower
 * (`--ios-edge-room`, added into `--app-safe-top` and `--focus-top`), and the
 * blurred band only ever holds the background. The native app turns the effect
 * off itself (ios-build.yml), and other browsers don't draw it.
 *
 * Marked before the first paint (an inline <head> script), so nothing moves.
 */
export const IOS_EDGE_ROOM = "28px";

export const IOS_WEB_APP_BOOT_SCRIPT =
  '(function(){try{if(window.navigator.standalone===true)document.documentElement.setAttribute("data-ios-web-app","")}catch(e){}})();';
