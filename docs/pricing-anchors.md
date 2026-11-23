# The home page's price examples: where every number comes from

The home page (jfeffect.com, signed out) opens its price story with two yearly
examples before the app is shown and its $0 is revealed. Both are worked out
in code from published prices, checked **Nov 23, 2026**, in Canadian dollars
before tax. This file records the sources so the numbers can be checked
again. The page itself never names a competing business; it describes each
example and keeps the maths and sources collapsed under "How this is worked
out" and "Where these numbers come from".

## 1. A personal trainer: $7,956 a year

`src/lib/coaching-packages/trainer-cost.ts`

Two private sessions a week at **$76.50**, the City of Edmonton's published
rate for one private personal training session for non-members:
$76.50 × 2 × 52 = $7,956 a year, about $663 a month. Once a week is about
$3,978 a year; three times about $11,934.

The other public rates checked, all shown on the page in the collapsed
sources with links:

| Provider | Published rate |
| --- | --- |
| City of Edmonton | $76.50 a session (non-members), $73 in a 5-pack, $70 in a 10-pack; members $61.20 |
| City of Calgary (Village Square Leisure Centre) | $415 for 5 ($83 each), $725 for 10 ($72.50 each) |
| City of Mississauga (2026) | $66.15 a session for 1 to 7, $56.23 for 8 or more, plus HST |
| City of Oshawa | $58.25 a session (members), $269.40 for 5, $495.10 for 10 |
| University of Ottawa | $59 a session, tax included |

The example is a public rec centre's single-session rate, not a private gym's
and not the highest rate checked (Calgary's 5-pack works out higher).

## 2. Higher-priced online coaching: $3,480 to $4,800 a year

`src/lib/coaching-packages/online-coaching-cost.ts`

| On the page | Source | Published price |
| --- | --- | --- |
| A Calgary strength coaching business | Calgary Barbell, calgarybarbell.com/coaching (Comprehensive Coaching: custom programming, intake call, weekly video check-in and form review, block review calls, unlimited communication) | $289.99 CAD a month |
| The same business, with nutrition | Calgary Barbell, calgarybarbell.com/nutrition (Comprehensive Coaching & Nutrition Package Deal) | $389.99 CAD a month |
| A Vancouver coach | Paris Demers, parisdemers.com/pages/online-fitness-coaching (online coaching, nutrition included, month to month) | From $400 CAD a month plus GST |

$289.99 × 12 = $3,480. $400 × 12 = $4,800.

Lower tiers from the same check, said on the page beside the range:
Calgary Barbell Fundamental Coaching $189.99 a month; Strengthcity Online
(Surrey, its Trainerize profile) General Fitness Coaching $199 and Performance
Coaching $249 a month.

## When each example shows

`src/lib/coaching-packages/cost-anchors.ts`: each example shows only while it
costs more than the highest monthly coaching package listed on the site, so
the story never asks anyone to read a lower number as the expensive one. The
online example also needs every listed monthly package to be below its
cheapest example ($289.99), so "higher-priced" stays true. With no coaching
package listed, neither shows.

## Checking them again

Change the sources and `CHECKED_ON` in both files together, and this file. The
tests in `src/test/price-reveal.test.ts` check the maths and the gating.
