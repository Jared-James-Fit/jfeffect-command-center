-- Seed JF powerlifting athlete identities and coaching eligibility windows.
-- OpenPowerlifting URLs are only populated where identity was verified.
insert into public.powerlifting_athletes (athlete_name,sex,openpowerlifting_url,jf_start_date,jf_end_date,auto_sync)
values
('Shaina Sagar','female','https://www.openpowerlifting.org/u/shainasagar',null,null,true),
('Nicole Carta','female',null,null,null,false),
('Fionna Gaburno','female',null,null,null,false),
('Dwayne Gordon','male','https://www.openpowerlifting.org/u/dwaynegordon',null,null,true),
('Laine Vandriel','female','https://www.openpowerlifting.org/u/lainevandriel',null,'2024-09-14',true),
('Kenneth Morris','male','https://www.openpowerlifting.org/u/kennethmorris',null,'2024-12-14',true),
('Jonathan Miranda','male','https://www.openpowerlifting.org/u/jonathanmiranda',null,'2024-07-13',true),
('Jared McIntyre','male','https://www.openpowerlifting.org/u/jaredmcintyre',null,null,true),
('Sarah Anderson','female','https://www.openpowerlifting.org/u/sarahanderson',null,null,true),
('Elisa Concetta Vena','female','https://www.openpowerlifting.org/u/elisaconcettavena',null,'2025-10-05',true),
('Leslie Emslie','female','https://www.openpowerlifting.org/u/leslieemslie',null,'2023-08-10',true),
('Phillip Bennett','male','https://www.openpowerlifting.org/u/phillipbennett4',null,null,true),
('Ashtyn Trudeau','female','https://www.openpowerlifting.org/u/ashtyntrudeau',null,'2023-06-17',true),
('Mikaela Macasaet','female','https://www.openpowerlifting.org/u/mikaelamacasaet','2023-08-10','2023-08-10',true),
('Branden Delarosa','male','https://www.openpowerlifting.org/u/brandendelarosa',null,'2024-02-03',true),
('Brandon Ramkalawan','male','https://www.openpowerlifting.org/u/brandonramkalawan',null,'2025-05-02',true),
('Jarrett Simard','male','https://www.openpowerlifting.org/u/jarrettsimard',null,'2025-03-22',true),
('Frederick Callahan','male','https://www.openpowerlifting.org/u/frederickcallahan','2023-07-21','2024-09-14',true),
('Alayna Wlodarczyk','female','https://www.openpowerlifting.org/u/alaynawlodarczyk','2022-10-16','2024-08-09',true),
('Nabil Ahmed','male','https://www.openpowerlifting.org/u/nabilahmed',null,'2024-05-04',true),
('Jeremy Martin','male','https://www.openpowerlifting.org/u/jeremymartin','2024-01-01','2024-12-14',true)
on conflict do nothing;

-- Canadian-only source restriction for the two identities that can collide with US lifters.
alter table public.powerlifting_athletes add column if not exists country_filter text;
update public.powerlifting_athletes set country_filter='Canada' where athlete_name in ('Kenneth Morris','Jeremy Martin');
