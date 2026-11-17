/**
 * The built-in festival calendar for the website's festival ads.
 *
 * Two years ahead: November 2026 to December 2028 (and New Year 2029). Each
 * ad shows from 7 days before the
 * festival until its last day; the office can edit, hide or delete any of them
 * (Admin -> Festival ads), add photos and its own words, and a deleted one is
 * never re-added (promotion_seed_log).
 *
 * Dates of lunar festivals follow the published 2026-28 calendars; where
 * sources differ, or the date depends on the moon (Eid), it says so in `notes`
 * so the office checks before the ad goes up. No prices or offers are written
 * here - only an invitation to book.
 */
import type Database from 'better-sqlite3';

export interface FestivalSeed {
  key: string;
  title: string;
  titleLocal: string;
  headline: string;
  message: string;
  theme: string;
  date: string;        // main day, YYYY-MM-DD
  end?: string;        // last day, when it runs several days
  notes?: string;
}

const BOOK = 'Book a clean cab with a verified chauffeur, 24×7 — call or WhatsApp us.';

export const FESTIVALS: FestivalSeed[] = [
  {
    key: 'guru-nanak-jayanti-2026', title: 'Guru Nanak Jayanti', titleLocal: 'गुरु नानक जयंती',
    headline: 'Gurpurab blessings to you and your family',
    message: `Wishing you a blessed Guru Nanak Jayanti. Going to the gurdwara or visiting family? ${BOOK}`,
    theme: 'gold', date: '2026-11-24',
  },
  {
    key: 'christmas-2026', title: 'Christmas', titleLocal: 'क्रिसमस',
    headline: 'Merry Christmas from JustCabs',
    message: `Midnight mass, family dinners and Christmas parties — get there and back safely. ${BOOK}`,
    theme: 'red', date: '2026-12-25',
  },
  {
    key: 'new-year-2027', title: 'New Year 2027', titleLocal: 'नया साल मुबारक',
    headline: 'Celebrate the New Year — we will drive you home',
    message: `Ring in 2027 with your friends and family and leave the driving to us. Don't drink and drive. ${BOOK}`,
    theme: 'purple', date: '2027-01-01',
  },
  {
    key: 'makar-sankranti-2027', title: 'Makar Sankranti', titleLocal: 'मकर संक्रांति',
    headline: 'तिळगूळ घ्या, गोड गोड बोला!',
    message: `Happy Makar Sankranti. Visiting family for til-gul and haldi-kumkum? ${BOOK}`,
    theme: 'saffron', date: '2027-01-14',
  },
  {
    key: 'republic-day-2027', title: 'Republic Day', titleLocal: 'गणतंत्र दिवस',
    headline: 'Happy Republic Day — plan the long weekend',
    message: `A long weekend for many: Lonavala, Mahabaleshwar, Alibaug, Nashik and more, door to door from Mumbai. ${BOOK}`,
    theme: 'tricolour', date: '2027-01-26',
  },
  {
    key: 'maha-shivratri-2027', title: 'Maha Shivratri', titleLocal: 'महाशिवरात्रि',
    headline: 'Har Har Mahadev — temple visits made easy',
    message: `Planning darshan at Trimbakeshwar, Bhimashankar, Babulnath or Ambernath? Travel together in one vehicle. ${BOOK}`,
    theme: 'indigo', date: '2027-03-06',
  },
  {
    key: 'eid-ul-fitr-2027', title: 'Eid ul-Fitr', titleLocal: 'ईद मुबारक',
    headline: 'Eid Mubarak from JustCabs',
    message: `Wishing you and your family a joyful Eid. Visiting relatives across the city? ${BOOK}`,
    theme: 'green', date: '2027-03-10',
    notes: 'Eid depends on the moon sighting (9 or 10 March 2027). Check and adjust the dates.',
  },
  {
    key: 'holi-2027', title: 'Holi', titleLocal: 'होली',
    headline: 'Happy Holi — play safe, ride safe',
    message: `Holika Dahan on the 21st, colours on the 22nd. Going home or to a Holi party? Leave the driving to us. ${BOOK}`,
    theme: 'pink', date: '2027-03-22', end: '2027-03-22',
    notes: 'Most calendars give Holika Dahan 21 Mar and Holi 22 Mar 2027; a few say 22/23 Mar.',
  },
  {
    key: 'gudi-padwa-2027', title: 'Gudi Padwa', titleLocal: 'गुढीपाडवा',
    headline: 'गुढीपाडव्याच्या हार्दिक शुभेच्छा!',
    message: `Happy Gudi Padwa and a prosperous Marathi New Year. Visiting family or the temple? ${BOOK}`,
    theme: 'saffron', date: '2027-04-07',
  },
  {
    key: 'ambedkar-jayanti-2027', title: 'Dr. Ambedkar Jayanti', titleLocal: 'आंबेडकर जयंती',
    headline: 'Jai Bhim — remembering Babasaheb',
    message: `Going to Chaitya Bhoomi or a gathering with family? Travel together, on time. ${BOOK}`,
    theme: 'blue', date: '2027-04-14',
  },
  {
    key: 'ram-navami-2027', title: 'Ram Navami', titleLocal: 'राम नवमी',
    headline: 'Jai Shri Ram — happy Ram Navami',
    message: `Temple visits and family celebrations — one vehicle for everyone. ${BOOK}`,
    theme: 'saffron', date: '2027-04-15',
  },
  {
    key: 'maharashtra-day-2027', title: 'Maharashtra Day', titleLocal: 'महाराष्ट्र दिन',
    headline: 'महाराष्ट्र दिनाच्या हार्दिक शुभेच्छा!',
    message: `Happy Maharashtra Day. A holiday to see the state — forts, hills and beaches, a day's drive from Mumbai. ${BOOK}`,
    theme: 'saffron', date: '2027-05-01',
  },
  {
    key: 'eid-al-adha-2027', title: 'Bakri Eid (Eid al-Adha)', titleLocal: 'ईद-उल-अज़हा',
    headline: 'Eid al-Adha Mubarak',
    message: `Wishing you and your family a blessed Bakri Eid. Visiting family across the city? ${BOOK}`,
    theme: 'green', date: '2027-05-17',
    notes: 'Depends on the moon sighting (16 or 17 May 2027). Check and adjust the dates.',
  },
  {
    key: 'independence-day-2027', title: 'Independence Day', titleLocal: 'स्वतंत्रता दिवस',
    headline: 'Happy Independence Day',
    message: `Flag hoisting, family outings or a monsoon drive to the ghats — we will take you there. ${BOOK}`,
    theme: 'tricolour', date: '2027-08-15',
  },
  {
    key: 'raksha-bandhan-2027', title: 'Raksha Bandhan', titleLocal: 'रक्षाबंधन',
    headline: 'Happy Raksha Bandhan — go and tie that rakhi',
    message: `Brother across town or in another city? Get there on time and come back comfortably. ${BOOK}`,
    theme: 'pink', date: '2027-08-17',
  },
  {
    key: 'janmashtami-2027', title: 'Janmashtami & Dahi Handi', titleLocal: 'जन्माष्टमी',
    headline: 'Govinda aala re! Happy Janmashtami',
    message: `Dahi Handi crowds close roads across Mumbai — book ahead and let the chauffeur handle the detours. ${BOOK}`,
    theme: 'blue', date: '2027-08-25', end: '2027-08-26',
    notes: 'Calendars give Janmashtami as 24 or 25 Aug 2027; Dahi Handi is the next day. Check before it goes live.',
  },
  {
    key: 'ganesh-chaturthi-2027', title: 'Ganesh Chaturthi', titleLocal: 'गणपती बाप्पा मोरया',
    headline: 'Ganpati Bappa Morya! Pandal visits and going home',
    message: `Lalbaug, GSB, Khetwadi and pandal hopping across the city — or going home to the village for Ganpati. One vehicle for the whole family. ${BOOK}`,
    theme: 'saffron', date: '2027-09-04', end: '2027-09-14',
    notes: 'Ganesh Chaturthi 4 Sep, Anant Chaturdashi (visarjan) 14 Sep 2027.',
  },
  {
    key: 'navratri-dussehra-2027', title: 'Navratri & Dussehra', titleLocal: 'नवरात्रि',
    headline: 'Garba nights, Durga Puja and Dussehra',
    message: `Nine nights of garba and dandiya — we drop you and pick you up late, safely. Happy Dussehra. ${BOOK}`,
    theme: 'red', date: '2027-09-30', end: '2027-10-09',
    notes: 'Sharad Navratri 30 Sep - 8 Oct, Dussehra 9 Oct 2027.',
  },
  {
    key: 'diwali-2027', title: 'Diwali', titleLocal: 'शुभ दीपावली',
    headline: 'Happy Diwali — home for the festival of lights',
    message: `Dhanteras to Bhai Dooj: shopping, family visits and going home for Diwali. ${BOOK}`,
    theme: 'gold', date: '2027-10-29', end: '2027-10-31',
    notes: 'Dhanteras 27 Oct, Lakshmi Puja 29 Oct, Padwa 30 Oct, Bhai Dooj 31 Oct 2027.',
  },
  {
    key: 'chhath-2027', title: 'Chhath Puja', titleLocal: 'छठ पूजा',
    headline: 'Going home for Chhath? Travel together, door to ghat',
    message: `Trains to Bihar and Purvanchal fill up weeks ahead. One cab or mini bus for the whole family, your own timings, prasad samagri on board. ${BOOK}`,
    theme: 'saffron', date: '2027-11-02', end: '2027-11-05',
    notes: 'Nahay Khay 2 Nov, Kharna 3 Nov, Sandhya Arghya 4 Nov, Usha Arghya 5 Nov 2027 (check locally).',
  },
  {
    key: 'guru-nanak-jayanti-2027', title: 'Guru Nanak Jayanti', titleLocal: 'गुरु नानक जयंती',
    headline: 'Gurpurab blessings to you and your family',
    message: `Wishing you a blessed Guru Nanak Jayanti. Going to the gurdwara or visiting family? ${BOOK}`,
    theme: 'gold', date: '2027-11-14',
  },
  {
    key: 'christmas-2027', title: 'Christmas', titleLocal: 'क्रिसमस',
    headline: 'Merry Christmas from JustCabs',
    message: `Midnight mass, family dinners and Christmas parties — get there and back safely. ${BOOK}`,
    theme: 'red', date: '2027-12-25',
  },

  /* -------------------------------- 2028 -------------------------------- */
  {
    key: 'new-year-2028', title: 'New Year 2028', titleLocal: 'नया साल मुबारक',
    headline: 'Celebrate the New Year — we will drive you home',
    message: `Ring in 2028 with your friends and family and leave the driving to us. Don't drink and drive. ${BOOK}`,
    theme: 'purple', date: '2028-01-01',
  },
  {
    key: 'makar-sankranti-2028', title: 'Makar Sankranti', titleLocal: 'मकर संक्रांति',
    headline: 'तिळगूळ घ्या, गोड गोड बोला!',
    message: `Happy Makar Sankranti. Visiting family for til-gul and haldi-kumkum? ${BOOK}`,
    theme: 'saffron', date: '2028-01-15',
  },
  {
    key: 'republic-day-2028', title: 'Republic Day', titleLocal: 'गणतंत्र दिवस',
    headline: 'Happy Republic Day — plan the long weekend',
    message: `Lonavala, Mahabaleshwar, Alibaug, Nashik and more, door to door from Mumbai. ${BOOK}`,
    theme: 'tricolour', date: '2028-01-26',
  },
  {
    key: 'maha-shivratri-2028', title: 'Maha Shivratri', titleLocal: 'महाशिवरात्रि',
    headline: 'Har Har Mahadev — temple visits made easy',
    message: `Planning darshan at Trimbakeshwar, Bhimashankar, Babulnath or Ambernath? Travel together in one vehicle. ${BOOK}`,
    theme: 'indigo', date: '2028-02-23',
  },
  {
    key: 'eid-ul-fitr-2028', title: 'Eid ul-Fitr', titleLocal: 'ईद मुबारक',
    headline: 'Eid Mubarak from JustCabs',
    message: `Wishing you and your family a joyful Eid. Visiting relatives across the city? ${BOOK}`,
    theme: 'green', date: '2028-02-27',
    notes: 'Eid depends on the moon sighting (26 or 27 Feb 2028). Check and adjust the dates.',
  },
  {
    key: 'holi-2028', title: 'Holi', titleLocal: 'होली',
    headline: 'Happy Holi — play safe, ride safe',
    message: `Holika Dahan on the 10th, colours on the 11th. Going home or to a Holi party? Leave the driving to us. ${BOOK}`,
    theme: 'pink', date: '2028-03-11',
    notes: 'Holika Dahan 10 Mar, Holi 11 Mar 2028.',
  },
  {
    key: 'gudi-padwa-2028', title: 'Gudi Padwa', titleLocal: 'गुढीपाडवा',
    headline: 'गुढीपाडव्याच्या हार्दिक शुभेच्छा!',
    message: `Happy Gudi Padwa and a prosperous Marathi New Year. Visiting family or the temple? ${BOOK}`,
    theme: 'saffron', date: '2028-03-27',
  },
  {
    key: 'ram-navami-2028', title: 'Ram Navami', titleLocal: 'राम नवमी',
    headline: 'Jai Shri Ram — happy Ram Navami',
    message: `Temple visits and family celebrations — one vehicle for everyone. ${BOOK}`,
    theme: 'saffron', date: '2028-04-04',
    notes: 'Worked out from Gudi Padwa (27 Mar 2028); check the panchang before it goes live.',
  },
  {
    key: 'ambedkar-jayanti-2028', title: 'Dr. Ambedkar Jayanti', titleLocal: 'आंबेडकर जयंती',
    headline: 'Jai Bhim — remembering Babasaheb',
    message: `Going to Chaitya Bhoomi or a gathering with family? Travel together, on time. ${BOOK}`,
    theme: 'blue', date: '2028-04-14',
  },
  {
    key: 'maharashtra-day-2028', title: 'Maharashtra Day', titleLocal: 'महाराष्ट्र दिन',
    headline: 'महाराष्ट्र दिनाच्या हार्दिक शुभेच्छा!',
    message: `Happy Maharashtra Day. A holiday to see the state — forts, hills and beaches, a day's drive from Mumbai. ${BOOK}`,
    theme: 'saffron', date: '2028-05-01',
  },
  {
    key: 'eid-al-adha-2028', title: 'Bakri Eid (Eid al-Adha)', titleLocal: 'ईद-उल-अज़हा',
    headline: 'Eid al-Adha Mubarak',
    message: `Wishing you and your family a blessed Bakri Eid. Visiting family across the city? ${BOOK}`,
    theme: 'green', date: '2028-05-05',
    notes: 'Depends on the moon sighting (5 or 6 May 2028). Check and adjust the dates.',
  },
  {
    key: 'raksha-bandhan-2028', title: 'Raksha Bandhan', titleLocal: 'रक्षाबंधन',
    headline: 'Happy Raksha Bandhan — go and tie that rakhi',
    message: `Brother across town or in another city? Get there on time and come back comfortably. ${BOOK}`,
    theme: 'pink', date: '2028-08-05',
  },
  {
    key: 'janmashtami-2028', title: 'Janmashtami & Dahi Handi', titleLocal: 'जन्माष्टमी',
    headline: 'Govinda aala re! Happy Janmashtami',
    message: `Dahi Handi crowds close roads across Mumbai — book ahead and let the chauffeur handle the detours. ${BOOK}`,
    theme: 'blue', date: '2028-08-13', end: '2028-08-14',
    notes: 'Janmashtami 13 Aug, Dahi Handi 14 Aug 2028 (from one calendar only — check).',
  },
  {
    key: 'independence-day-2028', title: 'Independence Day', titleLocal: 'स्वतंत्रता दिवस',
    headline: 'Happy Independence Day',
    message: `Flag hoisting, family outings or a monsoon drive to the ghats — we will take you there. ${BOOK}`,
    theme: 'tricolour', date: '2028-08-15',
  },
  {
    key: 'ganesh-chaturthi-2028', title: 'Ganesh Chaturthi', titleLocal: 'गणपती बाप्पा मोरया',
    headline: 'Ganpati Bappa Morya! Pandal visits and going home',
    message: `Lalbaug, GSB, Khetwadi and pandal hopping across the city — or going home to the village for Ganpati. One vehicle for the whole family. ${BOOK}`,
    theme: 'saffron', date: '2028-08-23', end: '2028-09-02',
    notes: 'Ganesh Chaturthi 23 Aug, Anant Chaturdashi (visarjan) 2 Sep 2028.',
  },
  {
    key: 'navratri-dussehra-2028', title: 'Navratri & Dussehra', titleLocal: 'नवरात्रि',
    headline: 'Garba nights, Durga Puja and Dussehra',
    message: `Nine nights of garba and dandiya — we drop you and pick you up late, safely. Happy Dussehra. ${BOOK}`,
    theme: 'red', date: '2028-09-19', end: '2028-09-27',
    notes: 'Sharad Navratri from 19 Sep, Dussehra 27 Sep 2028.',
  },
  {
    key: 'diwali-2028', title: 'Diwali', titleLocal: 'शुभ दीपावली',
    headline: 'Happy Diwali — home for the festival of lights',
    message: `Dhanteras to Bhai Dooj: shopping, family visits and going home for Diwali. ${BOOK}`,
    theme: 'gold', date: '2028-10-17', end: '2028-10-19',
    notes: 'Dhanteras 15 Oct, Lakshmi Puja 17 Oct, Padwa 18 Oct, Bhai Dooj 19 Oct 2028.',
  },
  {
    key: 'chhath-2028', title: 'Chhath Puja', titleLocal: 'छठ पूजा',
    headline: 'Going home for Chhath? Travel together, door to ghat',
    message: `Trains to Bihar and Purvanchal fill up weeks ahead. One cab or mini bus for the whole family, your own timings, prasad samagri on board. ${BOOK}`,
    theme: 'saffron', date: '2028-10-21', end: '2028-10-24',
    notes: 'Nahay Khay 21 Oct, Kharna 22 Oct, Sandhya Arghya 23 Oct, Usha Arghya 24 Oct 2028 (check locally).',
  },
  {
    key: 'guru-nanak-jayanti-2028', title: 'Guru Nanak Jayanti', titleLocal: 'गुरु नानक जयंती',
    headline: 'Gurpurab blessings to you and your family',
    message: `Wishing you a blessed Guru Nanak Jayanti. Going to the gurdwara or visiting family? ${BOOK}`,
    theme: 'gold', date: '2028-11-02',
    notes: 'Most calendars give 2 Nov 2028; a few say 1 or 5 Nov. Check before it goes live.',
  },
  {
    key: 'christmas-2028', title: 'Christmas', titleLocal: 'क्रिसमस',
    headline: 'Merry Christmas from JustCabs',
    message: `Midnight mass, family dinners and Christmas parties — get there and back safely. ${BOOK}`,
    theme: 'red', date: '2028-12-25',
  },
  {
    key: 'new-year-2029', title: 'New Year 2029', titleLocal: 'नया साल मुबारक',
    headline: 'Celebrate the New Year — we will drive you home',
    message: `Ring in 2029 with your friends and family and leave the driving to us. Don't drink and drive. ${BOOK}`,
    theme: 'purple', date: '2029-01-01',
  },
];

const minusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * Adds each built-in festival once. Safe to run on every start: a festival
 * already offered (even if the office later deleted it) is skipped.
 */
export function seedFestivalPromotions(db: Database.Database) {
  const seen = db.prepare('SELECT 1 FROM promotion_seed_log WHERE seed_key = ?');
  const add = db.prepare(
    `INSERT OR IGNORE INTO promotions
       (seed_key, kind, title, title_local, headline, message, theme,
        festival_date, festival_end, show_from, show_until, is_active, notes)
     VALUES (?, 'FESTIVAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );
  const log = db.prepare('INSERT OR IGNORE INTO promotion_seed_log (seed_key) VALUES (?)');
  db.transaction(() => {
    for (const f of FESTIVALS) {
      if (seen.get(f.key)) continue;
      const until = f.end ?? f.date;
      add.run(f.key, f.title, f.titleLocal, f.headline, f.message, f.theme,
        f.date, f.end ?? null, minusDays(f.date, 7), until, f.notes ?? null);
      log.run(f.key);
    }
  })();
}
