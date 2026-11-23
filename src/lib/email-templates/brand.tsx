import * as React from "react";
import { Hr, Img, Link, Section, Text } from "@react-email/components";

/**
 * The JF Effect frame every app email shares: the JF mark at the top, a quiet brand line at
 * the bottom. Black and white, with the logo as the only colour.
 *
 * The logo is the app icon already served from jfeffect.com (the same file the email
 * signatures use), shown at 40px from a 192px source so it stays sharp on retina screens.
 * The alt text keeps the header readable when a client blocks images.
 */
export const BRAND_LOGO_URL = "https://jfeffect.com/icon-192.png";
export const BRAND_SITE_URL = "https://jfeffect.com";
export const BRAND_INSTAGRAM_URL = "https://www.instagram.com/jaredmcintyre_/";
export const BRAND_YOUTUBE_URL = "https://www.youtube.com/@jared.mcintyre";

export function BrandHeader() {
  return (
    <Section style={header}>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        style={{ borderCollapse: "collapse" }}
      >
        <tbody>
          <tr>
            <td style={{ verticalAlign: "middle", paddingRight: "10px" }}>
              <Link href={BRAND_SITE_URL}>
                <Img src={BRAND_LOGO_URL} width="40" height="40" alt="JF" style={logo} />
              </Link>
            </td>
            <td style={{ verticalAlign: "middle" }}>
              <Text style={wordmark}>JF EFFECT</Text>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export function BrandFooter() {
  return (
    <Section>
      <Hr style={rule} />
      <Text style={footerLine}>
        <Link href={BRAND_SITE_URL} style={footerLink}>
          JF Effect
        </Link>
        {"  ·  "}Winnipeg, Manitoba, Canada
      </Text>
      <Text style={footerLine}>
        <Link href={BRAND_SITE_URL} style={footerLink}>
          jfeffect.com
        </Link>
        {"  ·  "}
        <Link href={BRAND_INSTAGRAM_URL} style={footerLink}>
          Instagram
        </Link>
        {"  ·  "}
        <Link href={BRAND_YOUTUBE_URL} style={footerLink}>
          YouTube
        </Link>
      </Text>
    </Section>
  );
}

const header = { margin: "0 0 24px" };
// With images blocked, most clients draw the alt text in this box: a red "JF" tile, same as the logo.
const logo = {
  display: "block",
  borderRadius: "8px",
  border: "0",
  backgroundColor: "#a51c1c",
  color: "#ffffff",
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: "15px",
  fontWeight: 800 as const,
  lineHeight: "40px",
  textAlign: "center" as const,
};
const wordmark = {
  margin: 0,
  fontFamily: "Inter, Arial, Helvetica, sans-serif",
  fontSize: "14px",
  fontWeight: 800 as const,
  letterSpacing: "0.12em",
  color: "#0b0b0b",
};
const rule = { borderColor: "#e5e5e5", margin: "32px 0 14px" };
const footerLine = {
  fontFamily: "Inter, Arial, Helvetica, sans-serif",
  fontSize: "12px",
  lineHeight: "1.6",
  color: "#7a7a7a",
  margin: "0",
};
const footerLink = { color: "#7a7a7a", textDecoration: "underline" };
