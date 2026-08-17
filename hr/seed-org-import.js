// Реальна структура Fresh Black станом на серпень 2026 — перелік
// співробітників, який Тетяна скинула текстом (employee_id/telegram/ПІБ/
// оформлення/директор/офіційна посада/посада). Департаменти — її власні
// заголовки розділів зі списку (не "контури" з Miro-схеми, яку вона
// показувала раніше — контури можна перебудувати вручну в інтерфейсі,
// якщо буде потрібно). "Директор" — реальний керівник за списком, лягає і
// в manager_employee_id (Employment Period), і в reports_to_position_id
// (Position) — обидва поля резолвляться при імпорті. Дат прийому на
// роботу в списку не було — start_date/first_hire_date ставляться на дату
// імпорту, це свідомо неточне значення (Тетяна знає, чому стаж/плинність
// на Дашборді після цього імпорту будуть невірні, поки не поправить дати
// вручну в картці кожного співробітника).
export const DEPARTMENTS = [
  'Фінансовий відділ',
  'Комерційний відділ',
  'Виробництво',
  'Рітейл',
  'Маркетинг та PR',
  'Технічний відділ',
  'Логістика',
  'Адміністрація'
];

export const EMPLOYEES = [
  // -- Фінансовий відділ --
  { employee_number: 'FB00059', telegram: '465734268', full_name: 'Максименко Альона Володимирівна', department: 'Фінансовий відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Заступник головного бухгалтера', working_title: 'Гол.бух.' },
  { employee_number: 'FB000120', telegram: '636728022', full_name: 'Задорожня-Кожадуб Анна Олегівна', department: 'Фінансовий відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Бухгалтер', working_title: 'бух. з реаліз.' },
  { employee_number: 'FB000103', telegram: '745026863', full_name: 'Сіденко Яна Василівна', department: 'Фінансовий відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Бухгалтер', working_title: 'бух. з вир-ва' },
  { employee_number: 'FB000133', telegram: '406593230', full_name: 'Бородіна Наталія Олександрівна', department: 'Фінансовий відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Економіст', working_title: 'економіст' },
  { employee_number: 'FB0000164', telegram: '1141603615', full_name: 'Кулікова Ірина', department: 'Фінансовий відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Бухгалтер', working_title: 'клієнт-банк' },

  // -- Комерційний відділ --
  { employee_number: 'FB000128', telegram: '905586834', full_name: 'Довгий Ілля Олегович', department: 'Комерційний відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Менеджер (управитель) із збуту', working_title: 'В2В' },
  { employee_number: 'FB0000163', telegram: '432536246', full_name: 'Соловей Іван Яковлевич', department: 'Комерційний відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Менеджер (управитель) із збуту', working_title: 'В2В' },
  { employee_number: 'FB000167', telegram: '775682421', full_name: 'Маковський Іван Володимирович', department: 'Комерційний відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Менеджер (управитель) із збуту', working_title: 'В2В' },
  { employee_number: 'FB001000', telegram: '566510555', full_name: 'Кириченко Юрій Валерійович', department: 'Комерційний відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Фінансовий аналітик', working_title: 'координатор' },
  { employee_number: 'FB000117', telegram: '388665239', full_name: 'Гончар Ірина Миколаївна', department: 'Комерційний відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Менеджер (управитель) із збуту', working_title: 'опер. менедж.' },

  // -- Виробництво --
  { employee_number: 'FB000160', telegram: '364771002', full_name: 'Кузнєцов Олексій Валентинович', department: 'Виробництво', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: '', working_title: 'Дир. виробн.' },
  { employee_number: 'FB000398', telegram: '627240878', full_name: 'Нападій Владислав Ігорович', department: 'Виробництво', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Директор виробництва', working_title: 'Стар. обсм' },
  { employee_number: 'FB000170', telegram: '387073198', full_name: 'Лобурєв Дмитро Павлович', department: 'Виробництво', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Оператор обжарювального апарата', working_title: 'Обсмажчик' },
  { employee_number: 'FB000172', telegram: '853721003', full_name: 'Фомченко Олександр Адамович', department: 'Виробництво', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Службовець на складі (комірник)', working_title: 'комірник' },
  { employee_number: 'FB00017', telegram: '5233262658', full_name: 'Яковлєв Андрій Костянтинович', department: 'Виробництво', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Комплектувальник товарів', working_title: 'фасувальник' },
  { employee_number: 'FB00155', telegram: '5267907930', full_name: 'Коваленко Сергій Анатолійович', department: 'Виробництво', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Комплектувальник товарів', working_title: 'фасувальник' },
  { employee_number: 'FB0000165', telegram: '1651852061', full_name: 'Коваль Катерина Вячеславівна', department: 'Виробництво', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Комплектувальник товарів', working_title: 'фасувальник' },
  { employee_number: 'FB000168', telegram: '961055672', full_name: 'Коваль Тетяна Сергіївна', department: 'Виробництво', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Комплектувальник товарів', working_title: 'фасувальник' },
  { employee_number: 'FB00169', telegram: '1923524038', full_name: 'Климчук Ірина Вікторівна', department: 'Виробництво', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Комплектувальник товарів', working_title: 'фасувальник' },
  { employee_number: 'FB001266', telegram: '923519843', full_name: 'Капінус Дмитро Сергійович', department: 'Виробництво', employment_type: 'Неофіційно', director: '', official_title: '', working_title: 'фасувальник' },

  // -- Рітейл --
  { employee_number: 'FB000127', telegram: '1086270631', full_name: 'Капран Євген Володимирович', department: 'Рітейл', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Генеральний менеджер (управитель)', working_title: 'Регіон. дир.' },
  { employee_number: 'FB0000166', telegram: '248687155', full_name: 'Пастернак Євгеній Євгенійович', department: 'Рітейл', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Менеджер (управитель) з питань регіонального розвитку', working_title: 'Рітейл' },

  // -- Маркетинг та PR --
  { employee_number: '', telegram: '', full_name: 'Арнова Анастасія Сергіївна', department: 'Маркетинг та PR', employment_type: 'ФОП', director: 'Шраменко Віктор Юрійович ФОП', official_title: 'ФОП', working_title: 'PR&Comm' },
  { employee_number: '', telegram: '', full_name: 'Вова Вадим Васильович', department: 'Маркетинг та PR', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Менеджер (управитель) з маркетингу', working_title: 'Digital' },
  { employee_number: '', telegram: '', full_name: 'Соколова Яна', department: 'Маркетинг та PR', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Фахівець з методів розширення ринку збуту (маркетолог)', working_title: '' },

  // -- Технічний відділ --
  { employee_number: 'FB00069', telegram: '413946267', full_name: 'Невінчаний Володимир Вікторович', department: 'Технічний відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Директор з якості', working_title: 'Бренд-бариста, директор з якості' },
  { employee_number: 'FB000146', telegram: '8730202810', full_name: 'Префонтейн Віктор Вікторович', department: 'Технічний відділ', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Інженер з організації експлуатації та ремонту', working_title: 'Технік' },
  { employee_number: 'FB000106', telegram: '679202523', full_name: 'Удод Денис Євгенійович', department: 'Технічний відділ', employment_type: 'ТОВ "НУАРЕ"', director: 'Полтавець Ксенія Андріївна', official_title: 'Інженер з організації експлуатації та ремонту', working_title: 'Технік' },
  { employee_number: 'FB000145', telegram: '1154117400', full_name: 'Нефьодов Ілля Іванович', department: 'Технічний відділ', employment_type: '', director: '', official_title: '', working_title: 'Технік' },

  // -- Логістика --
  { employee_number: 'FB00072', telegram: '1026620679', full_name: 'Майданік Святослав Петрович', department: 'Логістика', employment_type: 'ТОВ "ФУД ВОРКС", ТОВ "НУАРЕ"', director: 'Скок Олександр Олександрович, Полтавець Ксенія Андріївна', official_title: 'Менеджер (управитель) з логістики', working_title: 'Логіст' },
  { employee_number: 'FB000149', telegram: '', full_name: 'Драник Максим Михайлович', department: 'Логістика', employment_type: 'ТОВ "ФУД ВОРКС", ТОВ "НУАРЕ"', director: 'Скок Олександр Олександрович, Полтавець Ксенія Андріївна', official_title: 'Водій', working_title: 'водій' },
  { employee_number: '', telegram: '', full_name: 'Кізько Олена Віталіївна', department: 'Логістика', employment_type: 'ФОП', director: '', official_title: 'ФОП', working_title: 'водій' },
  { employee_number: 'FB000150', telegram: '', full_name: 'Кривенко Віталій Миколайович', department: 'Логістика', employment_type: 'ТОВ "ФУД ВОРКС", ТОВ "НУАРЕ"', director: 'Скок Олександр Олександрович, Полтавець Ксенія Андріївна', official_title: 'Водій', working_title: 'водій' },

  // -- Адміністрація --
  { employee_number: 'FB0002', telegram: '614681765', full_name: 'Скок Олександр Олександрович', department: 'Адміністрація', employment_type: 'ТОВ "ФУД ВОРКС"', director: '', official_title: 'Директор', working_title: 'Директор' },
  { employee_number: 'FB00Tehnolog', telegram: '1104236578', full_name: 'Колінченко Юлія Петрівна', department: 'Адміністрація', employment_type: 'Неофіційно', director: 'Скок Олександр Олександрович', official_title: '', working_title: 'технолог колд брю' },
  { employee_number: 'FB000152', telegram: '357796447', full_name: 'Сваволя Тетяна Євгеніївна', department: 'Адміністрація', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Директор з управління персоналом', working_title: 'HRD' },
  { employee_number: 'FB000183', telegram: '453075477', full_name: 'Рижа Анастасія Володимирівна', department: 'Адміністрація', employment_type: '', director: '', official_title: '', working_title: 'рекрутер' },
  { employee_number: 'FB00180', telegram: '8954849624', full_name: 'Чичва Тетяна Валентинівна', department: 'Адміністрація', employment_type: 'ТОВ "ФУД ВОРКС"', director: 'Скок Олександр Олександрович', official_title: 'Прибиральниця', working_title: 'прибир.' }
];
