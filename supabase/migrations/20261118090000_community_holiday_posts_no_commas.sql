-- Holiday posts, take 3: no commas (the coach's texts run on, they don't
-- pause), same two short lines. Shown in the regular post font now (see
-- NoteBody), not the big semibold photo-caption style.

UPDATE public.community_holidays h
   SET body = v.body, updated_at = now()
  FROM (VALUES
  ('new_year',
'happy new year 🎉 thank you for every rep last year fr 🙏

pick ONE habit for this year. not 10 just one. set a reminder to check on it next week 💪'),
  ('valentines',
'happy valentines day ❤️ love this crew fr

drop a comment on someones post in here today. takes 30 sec & it makes their day 🤝'),
  ('easter',
'happy easter yall 🐣 grateful for every one of you 🙏

go for a 20 min walk with the fam after the big meal. then eat the chocolate no guilt 🫡'),
  ('mothers_day',
'happy mothers day to the moms in here 💐 yall never miss 🙌

text your mom 1 thing she taught you that you still use. not just happy mothers day 🫶'),
  ('fathers_day',
'happy fathers day dads 👊 the kids are watching 💪

get 15 min of movement in with your kid (or your dad) today. a walk or catch is plenty'),
  ('canada_day',
'happy canada day 🇨🇦 enjoy the long weekend fr

glass of water before every drink today. future you will thank you tomorrow 🔥'),
  ('labour_day',
'happy labour day 💪 v proud of yall for training all summer

put this weeks sessions in your calendar rn. if its not scheduled it doesnt happen 🔥'),
  ('thanksgiving',
'happy thanksgiving yall 🦃 v grateful for every one of you 🙏

before you eat today text 1 person who helped you get here. then eat with zero guilt 💪'),
  ('halloween',
'happy halloween 🎃 yes you can have the candy lol

eat a real meal w protein before trick or treating & you''ll eat way less candy 🤣'),
  ('christmas',
'merry christmas yall 🎄 thank you for this year fr 🙏

phone in another room for one meal today. be all the way there. no tracking no guilt 💪')
  ) AS v(key, body)
 WHERE h.key = v.key;

-- This year's Thanksgiving post: same post, new words, unless the coach has
-- edited it in the app since (that sets edited_at).
UPDATE public.community_posts p
   SET caption = h.body, updated_at = now()
  FROM public.community_holidays h
 WHERE h.key = 'thanksgiving' AND p.series_key = 'holiday:thanksgiving:2026' AND p.edited_at IS NULL;
