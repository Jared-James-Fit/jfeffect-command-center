# Agreement updates for legal review (draft, Nov 17 2026)

**Status: DRAFT. Not published, not binding, not legal advice.** Written to be reviewed by a Manitoba lawyer before anything here is published from Admin → Legal or shipped in the Coaching Agreement. Nothing in this file is live.

Where each piece goes:

| Document | Where it lives | What to do |
|---|---|---|
| Terms of Service | `legal_documents` `terms-of-service`, v3 live, a v4 draft already exists in Admin → Legal | Put sections A1 to A11 into the v4 draft (replacing the paid-membership wording, see A0) |
| JF Membership Agreement | `membership-agreement`, v2 live (paid checkout), v3 and v4 drafts exist | Use the v3/v4 draft, apply section B, publish once (it starts the in-app signing sheet for every free member) |
| Coaching Agreement | `src/lib/coaching-agreement/content.ts` (2.3) | Archive 2.3 first (`supabase/agreement-archive/2.3.json`), then add section C as 2.4 |
| Screenshot and sharing policy | New public page, or a section of the Terms | Section D |

Principles behind every clause:

- Protect what JF Effect actually made (the software, its design, its programs and templates as written, its written and video content, its private business systems and AI instructions). Never claim general training knowledge, a client's own data or anything a third party owns.
- Let people use what they paid for or signed up for, including saving, screenshotting and sharing their own training and results.
- Restrict commercial exploitation, bulk extraction, attacks on the platform and exposing other people's private information.
- Keep remedies proportionate: warnings, removal, suspension, termination and the remedies the law already gives. No invented fees or penalties (penalty clauses aren't enforceable in Canada anyway).
- Never take away rights the law says can't be waived (Manitoba's Consumer Protection Act, the Copyright Act's user rights, privacy law).

---

## A. Terms of Service v4: new and replaced sections

### A0. Remove first

The live v3 still describes the retired paid membership: "$29 USD/month after a 3-day trial", access "after Stripe confirms", cancelling at /m/billing, and acceptance through "the acceptance box at sign-up" (which no longer exists). JF Effect is free to join, coaching is sold separately under the Coaching Agreement, and AI credit packs are an optional purchase. Replace sections 1.1 and 3 to 5 so they describe that, and define "the Service" as the JF Effect app, website and community, used by members and coaching clients alike.

### A1. Who these terms cover

> These Terms apply to everyone who uses the JF Effect app, website and community (the "Service"), whether you joined free or you're a coaching client. If you're a coaching client, your Coaching Agreement also applies, and if the two ever disagree about your coaching, the Coaching Agreement wins.

### A2. Your licence to use JF Effect

> JF Effect gives you a personal, limited, non-exclusive, non-transferable and revocable licence to use the Service for your own training, nutrition and progress, under these Terms. You can't sell, rent, lend, sublicense or transfer this licence. Nothing in these Terms limits a right the law gives you that can't be taken away.

### A3. What JF Effect owns, and what it doesn't

> The Service and what we created for it belong to JF Effect or our licensors: the app and its source code, its design and layout, the JF Effect name and logo, our original written content, videos, recipes and graphics, our program templates and training programs as we wrote them, our coaching tools, and the private systems behind them (including how our software and AI features are built and instructed). They're protected by copyright, trademark and other laws.
>
> We don't claim to own:
> - general training and nutrition knowledge, principles or methods (anyone can train with progressive overload, RPE or a calorie target);
> - your personal information, your training logs, your photos and videos, or anything else you create or upload (see A4);
> - content that belongs to someone else, like third-party exercise demonstrations or linked material.

**Legal review note:** confirm the business holds the copyright in contractor or collaborator contributions (code, videos, designs). See the ownership section of the audit report.

### A4. Your content

> You own what you create and upload: your logs, notes, photos, videos, posts, comments and messages. You give JF Effect a non-exclusive, royalty-free licence to store, copy, process and show your content only as needed to run the Service for you and the people you choose to share it with (for example, showing a post to the audience you picked, letting someone you allowed repost it in the app, or sending your set video to your coach). We don't use your content in our advertising or outside the Service without your separate permission. The licence ends when you delete the content or your account, except for copies other people already shared within the Service, backups kept for a limited time, and records we must keep by law.

**Legal review note:** the Coaching Agreement's content licence (2.3, around content.ts:490) says use "stays between you and the Coach's team", which doesn't cover Crew posts, reposts and shares. A4 and C3 fix that.

### A5. How you may not use JF Effect

> You agree not to:
> 1. copy, republish, sell, resell, rent, distribute or commercially use our programs, templates, recipes, written or video content, or other protected materials, except as these Terms or the law allow;
> 2. use bots, scrapers, crawlers or other automated tools to collect, copy or bulk download content or data from the Service, or use the Service in a way that puts an unreasonable load on it;
> 3. copy, decompile, disassemble or reverse engineer the Service's software, or try to get its source code, private instructions or configuration, except where the law expressly allows it despite this term (for example, for interoperability or security research as permitted by Canada's Copyright Act);
> 4. get around, disable or interfere with any security feature, access control or usage limit, or try to get into accounts, data or parts of the Service you aren't allowed to use;
> 5. try to get our AI features to reveal their instructions or to produce content for a competing product;
> 6. access, collect, publish or use another person's personal information without their permission;
> 7. impersonate anyone, or misrepresent your connection to JF Effect;
> 8. use the Service to break the law, harass anyone, or upload anything you don't have the right to share.

**Legal review notes:** (3) keeps the Copyright Act's exceptions (s. 30.6 to 30.63 for computer programs, interoperability, encryption and security research; s. 41.12 and 41.15 for technological protection measures) available, as required. (2) should stay paired with the technical rate limits now in place, so it reads as a description of what the Service enforces, not a trap.

### A6. Sharing, screenshots and recordings

Use the text in section D (the same wording as the standalone policy).

### A7. Confidential information

> Some things you may see as a coaching client or in a coach's message are confidential to JF Effect: unpublished programs and content, internal pricing and offers that aren't public, coach-only notes, and anything we clearly mark as confidential. Please don't share those outside the Service. This doesn't cover anything that's public, that you already knew, that you learned independently, or your own personal information and results.

### A8. Keeping your account safe

> Your account is for you alone. Keep your password private, don't share your login or let anyone else use your account, and tell us right away at [support email] if you think someone else has used it. You're responsible for what happens in your account unless it happened because of our own failure to protect it.

### A9. If someone breaks these Terms

> If you break these Terms, we may, depending on how serious it is: remind or warn you; remove content; limit features (for example, Crew access); suspend your account; or close it. Where we can, we'll tell you why and give you a chance to respond, unless that would put someone at risk or break the law. If you've paid for something, closing your account doesn't take away a refund the law or your agreement gives you. We may also use any remedy the law provides, including asking a court to stop serious misuse of our content or systems.

**Legal review note:** no fixed fees, liquidated damages or penalties; confirm the Manitoba CPA position on suspending a paid coaching client (the Coaching Agreement's termination terms should govern them).

### A10. Lawful competition

> Nothing in these Terms stops you from training, coaching or building your own products using general knowledge, your own skills, or anything that isn't JF Effect's protected material or confidential information.

### A11. Copyright and IP complaints

> If you think something on the Service infringes your rights, email [legal or support email] with what it is, where it is, and why. We'll review it and act on it where appropriate, including removing it.

**Legal review note:** confirm whether JF Effect has notice-and-notice obligations as a host under the Copyright Act (s. 41.25 to 41.27) and what to say about them.

---

## B. JF Membership Agreement (the v3/v4 draft)

1. **Remove** the paid-plan wording the draft still carries (s. 3: "$29 USD", "3-day trial", "$9 Hold Plan"). Membership is free; AI credit packs are optional purchases with their own price shown at purchase (before tax, plus GST/HST).
2. **Incorporate the Terms of Service** by reference: "These Terms of Service are part of this agreement. If they disagree, this agreement wins for your membership."
3. **Keep** the existing health and risk acknowledgements (`MEMBERSHIP_AGREEMENT_ACKS`) and the typed-name signature.
4. **Add one plain-language acknowledgement** to the ticks: "I'll use JF Effect for my own training, keep my login to myself, and won't copy or sell its programs or content." This is the one people will actually read, so it carries the IP and account-sharing terms into a recorded, ticked acknowledgement.
5. **Close the loophole before publishing** (from the agreements audit): Account → Privacy & legal's generic accept row records a typed name without the health and risk ticks, and `getMyMembershipAgreement` counts any typed-name row as signed. Make the membership agreement accept only through `MemberAgreementGate`, and count only rows with `context_ref = 'member_app'`.

## C. Coaching Agreement 2.4

Sections to change in `src/lib/coaching-agreement/content.ts`:

1. **`app` section (around :436)**: add the licence (A2) and the acceptable-use list (A5, items 1 to 8) by reference: "Your use of the JF Effect app is also covered by the Terms of Service, including how you may use and share its content."
2. **`ip` section (around :548)**: keep the ownership language; add the "what we don't claim" list from A3 and the lawful-competition line from A10.
3. **`content` section (around :480)**: replace "stays between you and the Coach's team" with A4, so Crew posts, reposts and shares are covered.
4. **New "Messages, screenshots and recordings" paragraph**: section D, plus: "Your messages with your coach are private. Please don't post screenshots of them, or of another client's information, without permission."
5. **New "Confidential information" paragraph**: A7.
6. **Acknowledgements (around :792)**: add one line, "I'll use my program and the app for my own training, and won't copy, share or sell them."

Re-signing: 2.4 should be signed by new clients automatically. For existing clients, decide whether to raise `RESIGN_REQUIRED_BELOW_VERSION` (forces everyone to re-sign, dismissible popup plus email or push) or rely on "Send another one" per client. My recommendation: require re-signing only if the lawyer considers the IP, sharing or content-licence changes material; otherwise publish 2.4 for new signers and send it to existing clients at their next renewal.

---

## D. Screenshots, recordings and sharing (plain-language policy)

> **Share your progress. Protect other people's privacy and our work.**
>
> **Go ahead and:**
> - screenshot or save your own workouts, program, nutrition plan and results for your own use;
> - share your own records, milestones, workout summaries and progress photos on social media;
> - post about your training with JF Effect and tag us;
> - show your program to a doctor, physiotherapist or other professional who's helping you.
>
> **Please don't:**
> - post another person's information, photos, messages or results without their permission (that includes screenshots of the Crew, group chats or your coach's messages to you);
> - sell, publish or distribute our programs, templates, recipes or content, or a copy of them, in whole or in a recognisable part;
> - systematically screenshot or record the app to copy its programs, content or design for another product or service;
> - use screenshots or recordings to get around a limit or a security feature.
>
> **Why:** JF Effect is built on original work, and the Crew only works if people feel safe sharing in it. What's yours to share is yours. Other people's information isn't, and our programs and content aren't free to resell.

How this is enforced in practice: by the agreement and A9, never by blocking screenshots. Browser screenshot blocking doesn't work, frustrates real users and isn't worth building. The share features (workout cards, Share to Instagram, Add to story) already make the branded, privacy-safe version of sharing the easiest one.

---

## E. Acceptance: what the app should do

What exists today (from the audit): free members accept nothing on record (a "by joining you agree" line); the Membership Agreement v3 that would ask them is unpublished; every gate is dismissible and enforced only in the app's screens; and the live documents describe the retired paid product.

Recommended, once the lawyer has approved the text:

1. **Sign-up (`/join`)**: an unticked checkbox, "I agree to the Terms of Service and Privacy Policy" with both linked, required to continue. Store the version ids with the sign-up and record the acceptance on the server when the email is confirmed (`/welcome`, `member_free_join`), as a `legal_acceptances` row (now server-written and stamped by the database). Marketing consent stays a separate, unticked choice.
2. **Existing members**: publish the Membership Agreement once. The in-app sheet (`MemberAgreementGate`) asks each launch, never mid-workout or over another sheet. After a grace period (suggest 14 days), switch the Terms and Membership Agreement to `full_portal_gate` so the app is read-only for anyone who hasn't accepted (their own data stays viewable and downloadable).
3. **Coaching clients**: the Coaching Agreement flow (already the strongest record in the system) stays as is.
4. **Server-side enforcement**: the gate is in the app, which is normal for clickwrap. If the lawyer wants enforcement that an API call can't skip, add a `legal_current(user)` check to the handful of server functions that create value (starting a program, posting to the Crew, AI features) rather than to every read.
5. **Admin**: add the missing "who hasn't accepted" list and show the stored snapshot and acknowledgement text with each acceptance (Admin → Legal). Enforcement mode and audience are database-only today; add them to the document's settings.

Records (done in this audit's migration): acceptances are written only by the server, stamped with the database's time and the published version's own text, and can't be edited or deleted (except with the login itself, through the existing cascade). A published version keeps its words forever, even once archived.

---

## F. For the lawyer: questions specific to Manitoba and Canada

1. **Consumer Protection Act (Manitoba), internet agreements**: does a free account count as a consumer agreement? For coaching (paid), confirm the disclosure, express-acceptance and copy-delivery requirements are met by the current flow (the signed copy is emailed).
2. **Electronic Commerce and Information Act (Manitoba)**: confirm clickwrap with a recorded checkbox and typed name is sufficient, and whether the stored snapshot, time, IP and user agent are adequate evidence.
3. **Enforceability of the acceptable-use and reverse-engineering terms** against consumers, given the Copyright Act's user rights.
4. **Forum, jury and class-action waivers** in the Coaching Agreement (2.3 has them): enforceability against Manitoba consumers after *Douez v. Facebook* (2017 SCC 33) and *Uber v. Heller* (2020 SCC 16).
5. **Privacy**: PIPEDA applies to the business's commercial activity. Health information (injuries, medications, conditions in the Health card and Nutrition Update) is sensitive and needs express consent; confirm the Privacy Policy v3 covers the health profile, AI processing (OpenAI and Google as processors, possibly outside Canada) and the message-history retention described in 2.3.
6. **The Privacy Act (Manitoba)**: whether to reference members' responsibility not to publish others' private information (section D).
7. **Accessibility for Manitobans Act**: whether the customer-service and information-and-communication standards apply at the business's size, and whether the agreement pages meet them (plain language, readable on a phone, screen-reader friendly).
8. **Ownership**: written assignment of IP from anyone else who contributed code, design, video or content; trademark registration for "JF Effect" if not already done.
