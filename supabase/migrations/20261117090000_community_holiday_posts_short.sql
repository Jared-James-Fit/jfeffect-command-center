-- Holiday posts, shorter: two short lines the way the coach actually texts
-- (a quick happy-holiday + thanks, then the one thing to do today), so the
-- whole caption shows in the feed under the photo without tapping "more".
-- Capped at 160 characters from here on.

UPDATE public.community_holidays h
   SET body = v.body, updated_at = now()
  FROM (VALUES
  ('new_year',
'happy new year 🎉 thank you for every rep last year fr 🙏

pick ONE habit for this year. not 10. one. set a reminder to check on it next week 💪'),
  ('valentines',
'happy valentines day ❤️ love this crew fr

drop a comment on someones post in here today. 30 sec & it makes their day 🤝'),
  ('easter',
'happy easter yall 🐣 grateful for every one of you 🙏

20 min walk after the big meal today. bring the fam. then eat the chocolate, no guilt 🫡'),
  ('mothers_day',
'happy mothers day to the moms in here 💐 yall never miss 🙌

text your mom 1 thing she taught you that you still use. not just happy mothers day 🫶'),
  ('fathers_day',
'happy fathers day dads 👊 the kids are watching 💪

get 15 min of movement in with your kid (or your dad) today. walk, catch, anything'),
  ('canada_day',
'happy canada day 🇨🇦 enjoy the long weekend fr

glass of water before every drink today. future you will thank you tomorrow 🔥'),
  ('labour_day',
'happy labour day 💪 v proud of yall for training all summer

put this weeks sessions in your calendar rn. if its not scheduled it doesnt happen 🔥'),
  ('thanksgiving',
'happy thanksgiving yall 🦃 v grateful for every one of you 🙏

before you eat today text 1 person who helped you get here. then eat, zero guilt 💪'),
  ('halloween',
'happy halloween 🎃 yes you can have the candy lol

eat a real meal w protein before trick or treating. you''ll eat way less candy 🤣'),
  ('christmas',
'merry christmas yall 🎄 thank you for this year fr 🙏

phone in another room for one meal today. be all the way there. no tracking no guilt 💪')
  ) AS v(key, body)
 WHERE h.key = v.key;

ALTER TABLE public.community_holidays DROP CONSTRAINT IF EXISTS community_holidays_body_short;
ALTER TABLE public.community_holidays ADD CONSTRAINT community_holidays_body_short CHECK (char_length(body) <= 160);

-- This year's Thanksgiving post already went out with the long version: same
-- post (reactions and comments stay), new words.
UPDATE public.community_posts p
   SET caption = h.body, updated_at = now()
  FROM public.community_holidays h
 WHERE h.key = 'thanksgiving' AND p.series_key = 'holiday:thanksgiving:2026'
   AND p.caption LIKE 'happy thanksgiving everyone%';
