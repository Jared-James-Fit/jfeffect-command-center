-- Holiday posts: no "fr" (the coach doesn't say it; it's on his never-say
-- list as of 20261012 #535). Only the four captions that had it change.

UPDATE public.community_holidays h
   SET body = v.body, updated_at = now()
  FROM (VALUES
  ('new_year',
'happy new year 🎉 thank you for every rep last year 🙏

pick ONE habit for this year. not 10 just one. set a reminder to check on it next week 💪'),
  ('valentines',
'happy valentines day ❤️ love this crew

drop a comment on someones post in here today. takes 30 sec & it makes their day 🤝'),
  ('canada_day',
'happy canada day 🇨🇦 enjoy the long weekend

glass of water before every drink today. future you will thank you tomorrow 🔥'),
  ('christmas',
'merry christmas yall 🎄 thank you for this year 🙏

phone in another room for one meal today. be all the way there. no tracking no guilt 💪')
  ) AS v(key, body)
 WHERE h.key = v.key;
