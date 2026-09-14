// Оновлення особистих даних співробітників з реального переліку, який
// Тетяна надіслала окремим файлом (вересень 2026) — телефони, корпоративні
// поштові адреси, дні народження, реальні дати прийому на роботу (замість
// технічної дати імпорту, яку ставив seed-org-import.js) і "Оформлення"
// (юр. особа/ФОП). Застосовується ідемпотентно через
// db.seedEmployeeRosterUpdate: заповнює лише порожні поля й дозволяє
// заміняти лише технічну дату-заглушку прийому на роботу (2026-08-27) —
// нічого, що Тетяна вже поправила вручну через інтерфейс, не чіпає.
//
// Одна людина з файлу ще не заведена в систему — Рубанка Анастасія
// (молодший КАМ, Рітейл) — по ній у файлі більше не було жодних даних,
// крім ПІБ і посади; заведена як картка-заглушка, решту полів (посада,
// департамент, дата прийому, контакти) Тетяні треба заповнити вручну.
//
// Одна підозріла адреса лишена як є в файлі, але з поштою НЕ підставлена
// сюди: рядок "Яковлєв Андрій Костянтинович" мав у колонці email текст
// "немає пошти" — це позначка "немає", не реальна адреса.
//
// Одна ймовірна одруківка в самому файлі (не виправлена, бо не мала
// підтвердження): "prefontein.v@ftesh.black" (замість "fresh.black") —
// перевір і поправ, якщо треба, через картку співробітника.
export const EMPLOYEE_ROSTER_UPDATE = [
  {
    "full_name": "Максименко Альона Володимирівна",
    "employee_number": "FB00059",
    "phone": "063 949 93 73",
    "telegram": "@alona_maksymenko",
    "corporate_email": "maksymenko.a@fresh.black",
    "birth_date": "1993-10-16",
    "first_hire_date": "2023-03-22",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Задорожня-Кожадуб Анна Олегівна",
    "employee_number": "FB000120",
    "phone": "093 013 54 39",
    "telegram": null,
    "corporate_email": "zadorozhnia.a@fresh.black",
    "birth_date": "1996-02-18",
    "first_hire_date": "2024-11-01",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Сіденко Яна Василівна",
    "employee_number": "FB000103",
    "phone": "067 465 81 97",
    "telegram": null,
    "corporate_email": "sidenko.y@fresh.black",
    "birth_date": "1993-07-21",
    "first_hire_date": "2024-06-12",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Бородіна Наталія Олександрівна",
    "employee_number": "FB000133",
    "phone": "050 709 21 60",
    "telegram": null,
    "corporate_email": "borodina.n@fresh.black",
    "birth_date": "2000-04-24",
    "first_hire_date": "2025-03-17",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Довгий Ілля Олегович",
    "employee_number": "FB000128",
    "phone": "066 231 80 96",
    "telegram": null,
    "corporate_email": "dovhyi.i@fresh.black",
    "birth_date": "2001-07-24",
    "first_hire_date": "2025-02-13",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Соловей Іван Яковлевич",
    "employee_number": "FB0000163",
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": null,
    "first_hire_date": null,
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Маковський Іван Володимирович",
    "employee_number": "FB000167",
    "phone": "066 725 63 61",
    "telegram": "@vn4k91",
    "corporate_email": null,
    "birth_date": "1991-11-30",
    "first_hire_date": "2026-03-12",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Кириченко Юрій Валерійович",
    "employee_number": "FB001000",
    "phone": null,
    "telegram": null,
    "corporate_email": "kyrychenko.y@fresh.black",
    "birth_date": "1983-12-05",
    "first_hire_date": "2025-09-26",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Гончар Ірина Миколаївна",
    "employee_number": "FB000117",
    "phone": "067 283 06 30",
    "telegram": null,
    "corporate_email": "gonchar.i@fresh.black",
    "birth_date": "2000-05-17",
    "first_hire_date": "2026-03-23",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Пастернак Євгеній Євгенійович",
    "employee_number": "FB0000166",
    "phone": "067 446 22 46",
    "telegram": null,
    "corporate_email": null,
    "birth_date": "1997-05-14",
    "first_hire_date": "2026-03-09",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Рубанка Анастасія",
    "employee_number": null,
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": null,
    "first_hire_date": null,
    "employed_under": null
  },
  {
    "full_name": "Арнова Анастасія Сергіївна",
    "employee_number": null,
    "phone": "095 351 84 17",
    "telegram": null,
    "corporate_email": null,
    "birth_date": "1997-09-11",
    "first_hire_date": "2026-03-16",
    "employed_under": "ФОП"
  },
  {
    "full_name": "Вова Вадим Васильович",
    "employee_number": null,
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": null,
    "first_hire_date": null,
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Соколова Яна",
    "employee_number": null,
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": null,
    "first_hire_date": null,
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Нападій Владислав Ігорович",
    "employee_number": "FB000398",
    "phone": "093 308 18 60",
    "telegram": null,
    "corporate_email": "napadii.v@fresh.black",
    "birth_date": "1995-01-28",
    "first_hire_date": "2023-08-08",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Лобурєв Дмитро Павлович",
    "employee_number": "FB000170",
    "phone": "099 274 88 29",
    "telegram": "@goduknow",
    "corporate_email": null,
    "birth_date": "2000-06-02",
    "first_hire_date": "2026-03-19",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Фомченко Олександр Адамович",
    "employee_number": "FB000172",
    "phone": "067 502 37 87",
    "telegram": null,
    "corporate_email": null,
    "birth_date": "1969-06-15",
    "first_hire_date": "2026-03-13",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Яковлєв Андрій Костянтинович",
    "employee_number": "FB00017",
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": "1997-09-12",
    "first_hire_date": "2019-12-12",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Коваленко Сергій Анатолійович",
    "employee_number": "FB00155",
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": null,
    "first_hire_date": null,
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Коваль Катерина Вячеславівна",
    "employee_number": "FB0000165",
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": "1983-06-10",
    "first_hire_date": "2026-03-02",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Коваль Тетяна Сергіївна",
    "employee_number": "FB000168",
    "phone": "097 303 67 31",
    "telegram": null,
    "corporate_email": null,
    "birth_date": "2007-11-16",
    "first_hire_date": "2026-03-13",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Климчук Ірина Вікторівна",
    "employee_number": "FB00169",
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": null,
    "first_hire_date": null,
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Капінус Дмитро Сергійович",
    "employee_number": "FB001266",
    "phone": "093 126 61 23",
    "telegram": null,
    "corporate_email": null,
    "birth_date": "2007-05-08",
    "first_hire_date": "2026-04-20",
    "employed_under": "неофіційно"
  },
  {
    "full_name": "Невінчаний Володимир Вікторович",
    "employee_number": "FB00069",
    "phone": "063 687 61 86",
    "telegram": null,
    "corporate_email": "nevinchaniy.v@fresh.black",
    "birth_date": "1989-03-30",
    "first_hire_date": "2023-07-27",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Префонтейн Віктор Вікторович",
    "employee_number": "FB000146",
    "phone": "097 942 25 59",
    "telegram": "@Pre42km",
    "corporate_email": "prefontein.v@ftesh.black",
    "birth_date": "1990-08-13",
    "first_hire_date": "2025-09-01",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Удод Денис Євгенійович",
    "employee_number": "FB000106",
    "phone": "097 354 07 51",
    "telegram": null,
    "corporate_email": null,
    "birth_date": "2005-06-24",
    "first_hire_date": null,
    "employed_under": "ТОВ \"НУАРЕ\""
  },
  {
    "full_name": "Нефьодов Ілля Іванович",
    "employee_number": "FB000145",
    "phone": "095 275 09 56",
    "telegram": "@servis_coffee",
    "corporate_email": "nefodov.i@fresh.black",
    "birth_date": "1998-08-27",
    "first_hire_date": "2025-09-01",
    "employed_under": null
  },
  {
    "full_name": "Майданік Святослав Петрович",
    "employee_number": "FB00072",
    "phone": "067 771 51 34",
    "telegram": null,
    "corporate_email": "maidanik.s@fresh.black",
    "birth_date": "1979-06-10",
    "first_hire_date": "2023-08-08",
    "employed_under": "ТОВ \"ФУД ВОРКС\", ТОВ \"НУАРЕ\""
  },
  {
    "full_name": "Кізько Олена Віталіївна",
    "employee_number": null,
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": "1965-09-15",
    "first_hire_date": null,
    "employed_under": "ФОП"
  },
  {
    "full_name": "Скок Олександр Олександрович",
    "employee_number": "FB0002",
    "phone": "063 075 66 79",
    "telegram": "@maruyc",
    "corporate_email": "skok.o@fresh.black",
    "birth_date": "1988-11-12",
    "first_hire_date": null,
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Колінченко Юлія Петрівна",
    "employee_number": "FB00Tehnolog",
    "phone": "067 918 45 33",
    "telegram": null,
    "corporate_email": null,
    "birth_date": "1980-05-01",
    "first_hire_date": "2025-08-09",
    "employed_under": "Неофіційно"
  },
  {
    "full_name": "Сваволя Тетяна Євгеніївна",
    "employee_number": "FB000152",
    "phone": "093 597 82 87",
    "telegram": "@SvoiaVolia",
    "corporate_email": "svavolia.t@fresh.black",
    "birth_date": "1991-01-13",
    "first_hire_date": "2025-11-03",
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  },
  {
    "full_name": "Рижа Анастасія Володимирівна",
    "employee_number": "FB000183",
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": null,
    "first_hire_date": null,
    "employed_under": null
  },
  {
    "full_name": "Чичва Тетяна Валентинівна",
    "employee_number": "FB00180",
    "phone": null,
    "telegram": null,
    "corporate_email": null,
    "birth_date": null,
    "first_hire_date": null,
    "employed_under": "ТОВ \"ФУД ВОРКС\""
  }
];
