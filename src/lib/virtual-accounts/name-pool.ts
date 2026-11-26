/**
 * Where virtual Crew accounts' names come from: first names by naming style, surnames by origin,
 * and how often each origin's surnames go with each style of first name. The mix is a Canadian
 * gym's (Manitoba's Ukrainian, Mennonite, Filipino, Punjabi and French communities included), so a
 * Wong is usually a Kevin, a Gagnon often a Mathieu, a Sandhu a Harpreet, a Friesen a Tyler.
 *
 * This file is data only. The generator is in the database (virtual_name_generate, written into
 * 20270602090000_virtual_account_names.sql by scripts/virtual-names/write-migration.ts from this
 * file and names-sql.ts), so every way an account gets a name (added, regenerated, corrected
 * automatically) uses one generator and one set of checks against the real members.
 *
 * Rules for what goes in (virtual-account-names.test.ts holds them):
 * - first names are one word (hyphens allowed): the Crew shows the first word of a name;
 * - no name reads as a placeholder, a bot, staff or a mash (names.ts placeholderReason);
 * - every style has women's and men's names; unisex ones are listed apart;
 * - a surname is never one that's famous on its own with the first names it pairs with (WELL_KNOWN).
 */

export type NameGender = "f" | "m" | "u";

export const NAME_STYLES = [
  "common",
  "celtic",
  "french",
  "italian",
  "germanic",
  "slavic",
  "filipino",
  "hispanic",
  "portuguese",
  "indian",
  "punjabi",
  "urdu",
  "mandarin",
  "vietnamese",
  "korean",
  "japanese",
  "akan",
  "igbo",
  "yoruba",
  "ethiopian",
  "somali",
  "arabic",
  "persian",
] as const;
export type NameStyle = (typeof NAME_STYLES)[number];

const list = (s: string) =>
  s
    .trim()
    .split(/\s*,\s*/)
    .filter(Boolean);

/** First names by style: women's, men's, and names used for both. One word each. */
export const FIRST_NAMES: Record<NameStyle, { f: string[]; m: string[]; u: string[] }> = {
  common: {
    f: list(`Alyssa, Natalie, Sophia, Emily, Vanessa, Megan, Lauren, Rachel, Kayla, Brooke, Jenna, Paige,
      Kelsey, Chelsea, Danielle, Brittany, Courtney, Amanda, Jessica, Samantha, Hailey, Madison, Olivia, Ava,
      Chloe, Claire, Abby, Rebecca, Leah, Erin, Shannon, Kristen, Hannah, Maya, Ellie, Grace, Emma, Sarah,
      Katie, Kendra, Tessa, Nicole, Melissa, Stephanie, Heather, Amber, Alicia, Monica, Jasmine, Tiffany,
      Whitney, Kara, Carly, Mackenzie, Sierra, Jade, Nina, Lena, Aiyana, Zoe, Ruby, Isla, Holly, Michelle,
      Brianna, Imani, Nia, Aaliyah, Meghan, Laura, Kristina, Jillian, Cassidy, Caitlyn`),
    m: list(`Ethan, Ryan, Daniel, Noah, Marcus, Tyler, Jacob, Liam, Owen, Caleb, Nathan, Evan, Logan, Mason,
      Cole, Brandon, Kyle, Derek, Adam, Connor, Dylan, Jason, Kevin, Justin, Eric, Brian, Travis, Garrett,
      Spencer, Shane, Trevor, Curtis, Wesley, Grant, Colin, Blake, Chase, Austin, Luke, Isaac, Aaron, Zachary,
      Brett, Jeremy, Patrick, Graham, Theo, Max, Ben, Matt, Nick, Josh, Jake, Sean, Scott, Andrew, Carter,
      Hunter, Bryce, Tanner, Dustin, Corey, Isaiah, Darius, Andre, Malik, Terrence, Elijah, Joel, Gavin,
      Dominic, Vincent, Simon, Henry, Oliver, Jack, Julian, Miles, Wyatt, Jonah, Tristan, Damon`),
    u: list(`Jordan, Taylor, Casey, Riley, Avery, Morgan, Jamie, Alex, Quinn, Cameron, Drew, Sam, Jesse,
      Rowan, Charlie, Dakota, Reese`),
  },
  celtic: {
    f: list(
      `Siobhan, Aisling, Fiona, Maeve, Caitlin, Shauna, Niamh, Orla, Ciara, Moira, Sinead, Isla, Bridget`,
    ),
    m: list(
      `Declan, Rory, Finn, Callum, Aidan, Kieran, Ronan, Cormac, Fergus, Angus, Euan, Lachlan, Niall`,
    ),
    u: [],
  },
  french: {
    f: list(`Camille, Élise, Geneviève, Chloé, Sophie, Amélie, Mélanie, Isabelle, Émilie, Valérie, Gabrielle,
      Mathilde, Juliette, Noémie, Rosalie, Annie, Josée, Marie-Ève, Anne-Sophie, Catherine`),
    m: list(`Mathieu, Étienne, Luc, Rémi, Gabriel, Olivier, Julien, Félix, Antoine, Maxime, Hugo, Benoît,
      Philippe, Sébastien, Alexandre, Louis, Yannick, Jérôme, Marc-Antoine, Guillaume`),
    u: list(`Dominique`),
  },
  italian: {
    f: list(`Giulia, Francesca, Chiara, Bianca, Alessia, Gianna, Marisa, Serena, Valentina, Lucia, Elena,
      Silvia, Martina, Federica, Carla`),
    m: list(`Marco, Luca, Matteo, Nico, Dario, Enzo, Paolo, Vincenzo, Giovanni, Stefano, Alessandro, Fabio,
      Lorenzo, Salvatore, Rocco`),
    u: [],
  },
  germanic: {
    f: list(`Ingrid, Freya, Anja, Greta, Lena, Maren, Annika, Katrin, Liesel, Sanne, Frieda, Astrid, Signe,
      Britt, Hanne`),
    m: list(`Lukas, Henrik, Erik, Anders, Jonas, Stefan, Felix, Niels, Matthias, Tobias, Sven, Lars, Johan,
      Bram, Emil`),
    u: [],
  },
  slavic: {
    f: list(`Oksana, Kateryna, Natalia, Halyna, Zofia, Agnieszka, Iryna, Daria, Olena, Sofiya, Marta, Yulia,
      Kasia, Tetiana, Lesia`),
    m: list(`Dmytro, Taras, Andriy, Bohdan, Yuri, Oleksandr, Pavel, Tomasz, Marek, Jakub, Ostap, Roman, Ivan,
      Vlad, Mykola`),
    u: [],
  },
  filipino: {
    f: list(`Mariel, Danica, Angelica, Kristine, Patricia, Bea, Joanna, Rhea, Maricel, Charmaine, Jessa,
      Aileen, Camille, Bianca, Trisha`),
    m: list(`Jericho, Paolo, Carlo, Miguel, Rafael, Jomar, Rommel, Arnel, Renz, Kristoffer, Jayson, Dante,
      Ramon, Jerome, Noel`),
    u: [],
  },
  hispanic: {
    f: list(`Sofía, Valeria, Camila, Lucía, Daniela, Mariana, Isabel, Ximena, Paola, Gabriela, Carolina,
      Andrea, Natalia, Fernanda, Renata, Adriana, Alejandra, Elena`),
    m: list(`Mateo, Diego, Carlos, Javier, Luis, Andrés, Rafael, Santiago, Joaquín, Emilio, Gabriel,
      Alejandro, Sergio, Ricardo, Pablo, Manuel, Raúl, Esteban, Cristian`),
    u: [],
  },
  portuguese: {
    f: list(`Inês, Beatriz, Joana, Leonor, Catarina, Marta, Rita, Sara`),
    m: list(`Tiago, João, Rui, Duarte, Gonçalo, Nuno, Pedro, André`),
    u: [],
  },
  indian: {
    f: list(`Priya, Ananya, Neha, Kavya, Riya, Meera, Anjali, Shreya, Pooja, Divya, Isha, Nisha, Tanvi, Aarti,
      Lakshmi`),
    m: list(`Arjun, Rohan, Vikram, Karan, Nikhil, Rahul, Sanjay, Ravi, Dev, Aditya, Varun, Siddharth, Akash,
      Neel, Kunal`),
    u: [],
  },
  punjabi: {
    f: list(
      `Simran, Harleen, Jasleen, Gurleen, Mehak, Kiranjit, Prabhleen, Avneet, Navneet, Rupinder`,
    ),
    m: list(`Gurjot, Karanveer, Ranveer, Jagdeep, Rajveer, Arshdeep, Tejinder, Harvinder`),
    u: list(
      `Harpreet, Manpreet, Gurpreet, Jaspreet, Navdeep, Amandeep, Sukhdeep, Jasmeet, Sandeep`,
    ),
  },
  urdu: {
    f: list(`Ayesha, Sana, Zainab, Hira, Mahnoor, Fatima, Amna, Iqra, Sadia, Nida, Mariam`),
    m: list(`Imran, Faisal, Hamza, Bilal, Usman, Zain, Danish, Asad, Saad, Adnan, Kashif`),
    u: [],
  },
  mandarin: {
    f: list(`Mei, Xin, Yan, Jia, Ling, Hui, Yun, Lan, Qian`),
    m: list(`Wei, Hao, Jun, Ming, Tao, Lei, Jian, Zhi, Peng`),
    u: list(`Yu`),
  },
  vietnamese: {
    f: list(`Linh, Thao, Trang, Mai, Vy, Hoa, Ngoc, Huong, Thu, Nhi`),
    m: list(`Duc, Huy, Khoa, Tuan, Bao, Long, Quang, Hieu, Phuc, Nam`),
    u: list(`Minh, Anh, Thanh`),
  },
  korean: {
    f: list(`Ji-woo, Seo-yeon, Hye-jin, Eun-ji, Soo-ah, Min-ji, Da-eun, Ha-eun, Ye-jin`),
    m: list(`Jae, Min-jun, Ji-hoon, Hyun-woo, Dong-hyun, Sung-min, Jun-ho, Tae-yang, Seung-woo`),
    u: [],
  },
  japanese: {
    f: list(`Aiko, Hana, Emi, Sakura, Yui, Mio, Haruka, Nanami`),
    m: list(`Kenji, Haruto, Daiki, Takumi, Kaito, Sota, Ryota, Yuto, Hiroshi`),
    u: list(`Ren, Yuki`),
  },
  akan: {
    f: list(`Ama, Abena, Akua, Efua, Adwoa, Esi, Afua`),
    m: list(`Kofi, Kwame, Kwabena, Kwesi, Yaw, Kojo, Kwaku`),
    u: [],
  },
  igbo: {
    f: list(`Adaeze, Chioma, Ngozi, Ifeoma, Nneka, Amara, Chiamaka, Adanna`),
    m: list(`Chinedu, Emeka, Obinna, Ikenna, Chidi, Chukwuma, Nnamdi`),
    u: list(`Uche, Kelechi`),
  },
  yoruba: {
    f: list(`Folake, Temi, Yewande, Funmi, Bisola, Titilayo, Kemi, Bukola`),
    m: list(`Tunde, Femi, Kunle, Wale, Segun, Dapo, Bayo`),
    u: list(`Seun, Dayo, Tobi, Ayomide`),
  },
  ethiopian: {
    f: list(`Selam, Liya, Meron, Bethlehem, Saba, Tsion, Mahlet, Hiwot, Rahel, Ruth`),
    m: list(`Dawit, Yonas, Abel, Bereket, Henok, Elias, Natnael, Tewodros, Kidus`),
    u: [],
  },
  somali: {
    f: list(`Hodan, Ayaan, Ifrah, Hibo, Sagal, Nimco, Ubah, Fadumo, Hawa, Ilhan`),
    m: list(`Abdi, Farhan, Hamza, Mohamed, Abdirahman, Liban, Yusuf, Hassan, Mahad, Guled`),
    u: [],
  },
  arabic: {
    f: list(
      `Layla, Yasmin, Nour, Rania, Leila, Mariam, Hala, Dina, Salma, Amira, Lina, Rana, Jana, Reem`,
    ),
    m: list(
      `Omar, Karim, Yusuf, Tariq, Hassan, Zaid, Sami, Rami, Khalil, Amir, Nabil, Fadi, Majid, Ziad`,
    ),
    u: [],
  },
  persian: {
    f: list(`Shirin, Parisa, Nazanin, Leila, Mitra, Yasaman, Roya, Setareh, Ladan, Neda`),
    m: list(`Arash, Dariush, Kian, Navid, Reza, Babak, Kaveh, Shahin, Arman`),
    u: [],
  },
};

export const NAME_ORIGINS = [
  "anglo",
  "celtic",
  "french",
  "italian",
  "germanic",
  "mennonite",
  "slavic",
  "filipino",
  "hispanic",
  "portuguese",
  "indian",
  "punjabi",
  "pakistani",
  "cantonese",
  "mandarin",
  "vietnamese",
  "korean",
  "japanese",
  "ghanaian",
  "igbo",
  "yoruba",
  "ethiopian",
  "somali",
  "kenyan",
  "arabic",
  "persian",
] as const;
export type NameOrigin = (typeof NAME_ORIGINS)[number];

/** Surnames by origin. A surname with a space or a particle is one surname ("Dela Cruz", "de Vries"). */
export const SURNAMES: Record<NameOrigin, string[]> = {
  anglo:
    list(`Mitchell, Bennett, Foster, Brooks, Parker, Hughes, Carter, Hayes, Fletcher, Lawson, Russell,
    Harper, Barnes, Turner, Palmer, Collins, Porter, Holland, Sutton, Chapman, Dawson, Webb, Marshall,
    Spencer, Warren, Hudson, Bishop, Hart, Lowe, Sharpe, Watts, Pearce, Gibson, Hammond, Cooke, Barrett,
    Willis, Rowe, Atkinson, Newman, Whitaker, Ellison, Thornton, Bradley, Kendall, Whitford, Ellis, Pike,
    Carver, Langley, Prescott, Hale, Ashford, Bowman, Caldwell, Everett, Goodwin, Hollis, Lockwood,
    Merritt, Osborne, Radford, Sheldon, Tate, Vaughn, Walton, Yates, Abbott, Benson, Crawford, Dalton,
    Emerson, Fowler, Gardner, Harding, Jennings, Kirby, Mercer, Nash, Oakley, Preston, Ramsey, Sawyer,
    Talbot, Wheeler, Morgan, Hargrove, Pritchard`),
  celtic:
    list(`Sullivan, O'Brien, Gallagher, Doyle, Kavanagh, Brennan, Quinn, Donnelly, MacDonald, McKenzie,
    Campbell, Fraser, Murray, Fitzgerald, Callaghan, Byrne, McLeod, Sinclair, Duncan, Walsh, Monaghan,
    Farrell, Lynch, Moran, Reid, Kerr, Wallace, Spence, Flett, Linklater, Keegan, Cassidy, Mulligan, Boyle`),
  french:
    list(`Gagnon, Tremblay, Côté, Bouchard, Gauthier, Lavoie, Fortin, Bélanger, Pelletier, Lévesque,
    Bergeron, Leblanc, Girard, Morin, Dubois, Fontaine, Lachance, Beaulieu, Desjardins, Caron, Paquette,
    Thériault, Boucher, Chartrand, Lamontagne, Gosselin, Poirier, Arsenault, Cormier, Michaud, Ouellet,
    Dufresne, Nadeau, Bourassa, Lalonde, Sauvé`),
  italian:
    list(`Rossi, Moretti, Romano, Ricci, Marino, Greco, Bruno, Gallo, Conti, Costa, De Luca, Mancini,
    Lombardi, Barone, Ferraro, Caruso, Esposito, Santoro, Fabbri, Rinaldi, Colombo, Russo, Vitale, Bianchi,
    Galli, Testa, Parisi, Sartori, Pellegrini, Benedetti`),
  germanic:
    list(`Schneider, Weber, Fischer, Becker, Hoffmann, Wagner, Keller, Lange, Vogel, Brandt, Neumann,
    Jansen, de Vries, Van Dyk, Bakker, Lindqvist, Nilsen, Larsen, Andersen, Halvorsen, Berg, Dahl, Schmidt,
    Krause, Hartmann, Kuhn, Visser, Mulder, Lindgren, Sorensen`),
  mennonite:
    list(`Friesen, Penner, Klassen, Wiebe, Thiessen, Dueck, Enns, Reimer, Loewen, Unrau, Hiebert,
    Giesbrecht, Martens, Harder, Neufeld, Kroeker, Fehr, Doerksen`),
  slavic:
    list(`Kowalczyk, Nowak, Novak, Shevchenko, Bondarenko, Kovalenko, Melnyk, Hrynchuk, Boychuk, Kozak,
    Petrenko, Sawchuk, Wozniak, Lysenko, Hnatiuk, Kravets, Mazur, Pawlak, Marchenko, Savchenko, Kuzyk,
    Romaniuk, Holub, Danyluk, Fedoruk, Kostiuk, Yaremchuk, Dvorak, Babiak, Wasylyk`),
  filipino:
    list(`Santos, Reyes, Cruz, Dela Cruz, Bautista, Mendoza, Villanueva, Aquino, Ramos, Navarro,
    Castillo, Mercado, Pascual, Domingo, Soriano, Manalo, Tolentino, Dizon, Salazar, Fernandez, Lim, Sison,
    Magbanua, Valdez, De Guzman, Gonzales, Marquez, Abad, Ocampo, Tan, Agustin, Rosales, Evangelista`),
  hispanic:
    list(`Morales, Herrera, Castillo, Vargas, Ortiz, Ramírez, Torres, Flores, Rivera, Gómez, Díaz,
    Mendoza, Rojas, Navarro, Salinas, Aguilar, Fuentes, Estrada, Delgado, Sandoval, Peña, Cabrera, Marín,
    Molina, Serrano, Cortés, Reyes, Cruz, Vega, Ibarra, Paredes, Montoya, Campos, Lozano, Medina, Guerrero`),
  portuguese:
    list(`Silva, Ferreira, Pereira, Medeiros, Carvalho, Sousa, Almeida, Rodrigues, Oliveira,
    Martins, Pinto, Teixeira, Lopes, Moreira, Correia`),
  indian:
    list(`Sharma, Patel, Mehta, Iyer, Nair, Reddy, Joshi, Kapoor, Desai, Rao, Malhotra, Chopra,
    Bhatia, Kulkarni, Menon, Pillai, Agarwal, Verma, Gupta, Shah, Banerjee, Mukherjee, Chatterjee, Raman`),
  punjabi:
    list(`Gill, Sandhu, Dhillon, Grewal, Sidhu, Brar, Singh, Kaur, Bains, Sohal, Toor, Mann, Cheema,
    Johal, Atwal, Chahal, Hundal, Dhaliwal, Randhawa`),
  pakistani:
    list(`Khan, Qureshi, Siddiqui, Hussain, Malik, Chaudhry, Iqbal, Raza, Sheikh, Mirza, Anwar,
    Javed, Akhtar, Rizvi`),
  cantonese:
    list(`Wong, Chan, Lam, Leung, Ng, Ho, Cheung, Lau, Yeung, Tse, Kwan, Fong, Mak, Chow, Tam, Yip,
    Choy, Lai`),
  mandarin: list(
    `Chen, Zhang, Liu, Huang, Wu, Lin, Zhou, Li, Wang, Xu, Zhao, Sun, Yang, Gao, Guo, Zhu`,
  ),
  vietnamese: list(
    `Nguyen, Tran, Le, Pham, Hoang, Phan, Vu, Dang, Bui, Ngo, Duong, Ly, Truong, Vo, Huynh`,
  ),
  korean: list(
    `Kim, Park, Lee, Choi, Jung, Kang, Cho, Yoon, Jang, Han, Shin, Seo, Kwon, Song, Baek, Hwang`,
  ),
  japanese:
    list(`Tanaka, Sato, Suzuki, Takahashi, Watanabe, Nakamura, Kobayashi, Yamamoto, Ito, Mori,
    Hayashi, Kato, Shimizu, Inoue, Kimura, Saito`),
  ghanaian:
    list(`Mensah, Owusu, Asante, Boateng, Osei, Addo, Danso, Agyeman, Appiah, Ofori, Amoah, Darko,
    Badu, Frimpong, Antwi`),
  igbo: list(`Okafor, Okonkwo, Eze, Nwosu, Okoro, Obi, Ibe, Nwachukwu, Okeke, Onyeka, Uzoma, Chukwu,
    Anyanwu, Nwankwo, Ugwu`),
  yoruba:
    list(`Adeyemi, Balogun, Adebayo, Ogunleye, Oyelaran, Bello, Akinola, Adewale, Olaniyan, Afolabi,
    Ogunbanjo, Adeleke, Olatunji, Oladipo, Fashola`),
  ethiopian:
    list(`Tesfaye, Alemu, Girma, Haile, Gebre, Bekele, Tadesse, Mekonnen, Wolde, Assefa, Kebede,
    Desta, Abebe, Tekle`),
  somali: list(
    `Warsame, Mohamud, Osman, Abdi, Jama, Ahmed, Duale, Egal, Nur, Ibrahim, Aden, Hirsi, Farah`,
  ),
  kenyan: list(
    `Otieno, Kamau, Mwangi, Njoroge, Ochieng, Odhiambo, Kariuki, Omondi, Wambui, Muthoni, Chebet`,
  ),
  arabic:
    list(`Haddad, Khalil, Nasser, Saleh, Mansour, Aziz, Rahman, Hamdan, Darwish, Karam, Abboud, Saab,
    Najjar, Issa, Shaheen, Hijazi, Toma, Khoury, Sabbagh, Bitar, Hakim, Shami, Yousef, Masri`),
  persian:
    list(`Ahmadi, Karimi, Rahimi, Hosseini, Moradi, Rostami, Jafari, Tehrani, Mohammadi, Sadeghi,
    Rezaei, Ghorbani, Kazemi, Farahani, Bagheri`),
};

/** Surnames that go with one gender only (Sikh names: Singh for men, Kaur for women). */
export const SURNAME_ONLY_GENDER: Record<string, "f" | "m"> = { Singh: "m", Kaur: "f" };

/**
 * Each origin: how often its surnames come up (relative weight, a Canadian mix that leans on
 * Manitoba's communities) and which styles of first name go with them, in what share.
 */
export const ORIGIN_RULES: Record<
  NameOrigin,
  { weight: number; pairs: Partial<Record<NameStyle, number>> }
> = {
  anglo: { weight: 14, pairs: { common: 0.9, celtic: 0.1 } },
  celtic: { weight: 8, pairs: { common: 0.7, celtic: 0.3 } },
  french: { weight: 7, pairs: { french: 0.55, common: 0.45 } },
  italian: { weight: 5, pairs: { italian: 0.45, common: 0.55 } },
  germanic: { weight: 5, pairs: { germanic: 0.35, common: 0.65 } },
  mennonite: { weight: 4, pairs: { common: 0.9, germanic: 0.1 } },
  slavic: { weight: 6, pairs: { slavic: 0.4, common: 0.6 } },
  filipino: { weight: 7, pairs: { filipino: 0.45, common: 0.35, hispanic: 0.2 } },
  hispanic: { weight: 6, pairs: { hispanic: 0.75, common: 0.25 } },
  portuguese: { weight: 2, pairs: { portuguese: 0.7, common: 0.3 } },
  indian: { weight: 4, pairs: { indian: 0.8, common: 0.2 } },
  punjabi: { weight: 5, pairs: { punjabi: 0.9, common: 0.1 } },
  pakistani: { weight: 2, pairs: { urdu: 0.85, common: 0.15 } },
  cantonese: { weight: 4, pairs: { common: 1 } },
  mandarin: { weight: 3, pairs: { mandarin: 0.5, common: 0.5 } },
  vietnamese: { weight: 3, pairs: { vietnamese: 0.45, common: 0.55 } },
  korean: { weight: 3, pairs: { korean: 0.45, common: 0.55 } },
  japanese: { weight: 1.5, pairs: { japanese: 0.45, common: 0.55 } },
  ghanaian: { weight: 2, pairs: { akan: 0.6, common: 0.4 } },
  igbo: { weight: 2, pairs: { igbo: 0.6, common: 0.4 } },
  yoruba: { weight: 2, pairs: { yoruba: 0.6, common: 0.4 } },
  ethiopian: { weight: 1.5, pairs: { ethiopian: 0.75, common: 0.25 } },
  somali: { weight: 1.5, pairs: { somali: 0.9, common: 0.1 } },
  kenyan: { weight: 1, pairs: { common: 1 } },
  arabic: { weight: 4, pairs: { arabic: 0.8, common: 0.2 } },
  persian: { weight: 1.5, pairs: { persian: 0.75, common: 0.25 } },
};

/**
 * Full names a generated account must never have: well-known people whose first name and
 * surname are both in the pool (athletes, lifters, actors, musicians, politicians), and a few
 * famous fictional ones. Folded with names.ts foldName before they're stored.
 */
export const WELL_KNOWN =
  list(`Kevin Hart, Elijah Harper, Wyatt Russell, Justin Turner, Jesse Norris,
  Diego Rivera, Sergio Ramos, Rui Costa, André Silva, Tiago Silva, Arjun Kapoor, Dev Patel,
  Siddharth Malhotra, Neha Sharma, Anjali Menon, Imran Khan, Faisal Qureshi, Emeka Okafor, Femi Adebayo,
  Abel Tesfaye, Mohamed Farah, Ayaan Hirsi, Yasmin Hamdan, Marco Rossi, Paolo Rossi, Jagmeet Singh,
  Kenji Tanaka, Kofi Annan, Abebe Bikila, Ryan Reynolds, Emma Watson, Emma Stone, Ryan Gosling,
  Chris Evans, Tom Brady, Ronnie Coleman, Jay Cutler, Phil Heath, Chris Bumstead, Eddie Hall, Brian Shaw,
  John Haack, Taylor Atwood, Ray Williams, Larry Wheels, Dan Green, Greg Nuckols, Eric Helms, Jeff Nippard,
  Layne Norton, Ben Pollack, Stefi Cohen, Jessica Buettner, Amanda Lawrence, Jamal Browner, Austin Perkins,
  Taylor Swift, Michael Jordan, Dwayne Johnson, Grace Kelly, Isaac Newton, Luke Bryan, Owen Wilson,
  Jordan Peterson, Justin Bieber, Connor McDavid, Sidney Crosby, Nathan MacKinnon, Carey Price,
  Andre De Grasse, Kyle Lowry, Jonathan Toews, Brady Tkachuk, Matthew Tkachuk, Bo Horvat, Diego Luna,
  Oscar Isaac, Pedro Pascal, Carlos Santana, Ricky Martin, Marc Anthony, Lucia Rossi, Hannah Montana,
  Daniel Craig, Henry Cavill, Jack Black, Liam Neeson, Noah Lyles, Aaron Judge, Shane Wright, Tyler Perry,
  Lin Dan, Li Na, Ming Yao, Jun Ma`);
