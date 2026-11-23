-- JF Effect: contact-address-only drafts of the published legal documents.
-- NOT a migration. Run by hand (or redo in Admin > Legal) only after the new
-- addresses are confirmed receiving mail. Creates DRAFTS; publishing stays a
-- separate admin step (Admin > Legal > Publish, with the review confirmation).
--
-- Each draft copies the current published version word for word and changes only
-- jaredjamesfit@gmail.com to the business address. requires_reacceptance = false:
-- a contact address change is not a change to anyone's rights, so nobody is asked
-- to accept again. Earlier published versions (what people accepted) never change.
--
--   privacy-policy                 v3 -> v4   support@jfeffect.com (privacy requests)
--   terms-of-service               v3 -> v5   support@jfeffect.com (v4 is Jared's pending draft)
--   cancellation-and-refund-policy v2 -> v3   billing@jfeffect.com
--   membership-agreement           v2 -> v5   billing@jfeffect.com (v3, v4 are Jared's pending drafts)
--
-- Jared's own pending drafts (terms v4, membership v3 and v4) still contain the Gmail
-- address. Swap it in Admin > Legal when he publishes them; nothing else in them is
-- touched here.

with src(vid, addr) as (values
  ('e4b54a8a-65c2-42c3-9603-3f5f4b25cc25'::uuid, 'support@jfeffect.com'),  -- privacy-policy v3
  ('3d7e3631-0a83-42ff-97bd-881a4c59018c'::uuid, 'support@jfeffect.com'),  -- terms-of-service v3
  ('11fbf24d-4d0c-4cf8-8258-fe7b8922be0e'::uuid, 'billing@jfeffect.com'),  -- cancellation-and-refund-policy v2
  ('9a64d8cd-985d-4d8b-9428-679005209504'::uuid, 'billing@jfeffect.com')   -- membership-agreement v2
)
insert into legal_document_versions (
  document_id, version_number, status, title, summary, body, signature_method,
  requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review,
  legal_review_note, created_by)
select v.document_id,
       (select max(x.version_number) + 1 from legal_document_versions x where x.document_id = v.document_id),
       'draft', v.title,
       'Contact address update only: ' || s.addr || ' replaces the personal Gmail address. No other wording changes.',
       replace(v.body, 'jaredjamesfit@gmail.com', s.addr),
       v.signature_method, false, v.reacceptance_audience, null, true,
       'Address-only change from published v' || v.version_number || '. Publish after ' || s.addr || ' is confirmed receiving mail.',
       v.created_by
from legal_document_versions v
join src s on s.vid = v.id
where v.status = 'published';

-- Settings rows (one row each), also only after the addresses receive mail:
-- update jf_membership_settings           set support_email = 'support@jfeffect.com';
-- update membership_onboarding_email_settings set support_email = 'support@jfeffect.com';
