// Реальна орг-структура Fresh Black — контури й ЦКП з Miro-схеми, реальні
// ПІБ/employee_id/telegram/оформлення з переліку співробітників, який
// Тетяна дала окремо (щоб правильно підставити людей у контури, не як
// самостійну плоску структуру). "key" — лише службовий ідентифікатор для
// резолву parent/reports_to всередині цього файлу, у базу не потрапляє.
//
// Кілька місць, де Miro-схема й реальний перелік співробітників не
// збігаються один-в-один (позначки нижче) — це усвідомлені припущення,
// не помилки: Тетяна сама поправить через інтерфейс, якщо не так.
//   - Кузнєцов Олексій (working title "Дир. виробн.") -> Керівник
//     виробництва; Нападій Владислав (working title "Стар. обсм.",
//     official "Директор виробництва") -> Старший обсмажчик — за робочою
//     назвою посади, не за офіційною (юридичний титул часто не збігається
//     з фактичною роллю в невеликих компаніях).
//   - 6 людей з working title просто "фасувальник" (без уточнення станції)
//     заведені як 6 окремих посад "Фасувальник" під Старшим обсмажчиком —
//     не намагались вгадати, хто саме на якій станції (напівавтомат/
//     фотосепаратор/дріп-станок тощо) без підтвердження.
//   - Колінченко Юлія (у переліку — розділ "Адміністрація", посада
//     "технолог колд брю") — заведена в Виробництво/R&D-Технолог за
//     функцією, а не за розділом переліку.
//   - Арнова Анастасія (PR&Comm, ФОП) — призначена на вузол "Comm/PR",
//     якому в Miro не було підписано конкретної людини.
//   - Полтавець Ксенія Андріївна і Корнієнко Андрій згадуються в Miro, але
//     їх немає в переліку співробітників — заведені як окремі люди
//     (Полтавець — за даними "Директор" з переліку логістики/техвідділу,
//     реальний employee_id невідомий) або лишені вакантними (Корнієнко).

export const DEPARTMENTS = [
  { key: 'admin', name: 'Адміністративний контур', parent: null, purpose: 'Існує для того, щоб компанія Fresh Black мала чіткий напрям руху, зрозумілу систему управління та узгоджену роботу всіх відділень. Забезпечує прийняття і реалізацію управлінських рішень, підтримує порядок у правилах і взаємодії та знімає з власника потребу керувати компанією в ручному режимі.' },
  { key: 'hr', name: 'Контур управління персоналом', parent: null, purpose: 'Існує для того, щоб у компанії Fresh Black були потрібні люди потрібної якості, які розуміють свої ролі, стандарти роботи та відповідальність. Забезпечує стабільність команди, її адаптацію і розвиток, зменшує залежність бізнесу від окремих людей і дозволяє компанії зростати без кадрового хаосу.' },
  { key: 'finance', name: 'Фінансовий контур', parent: null, purpose: 'Існує для того, щоб власник і керівництво Fresh Black мали достовірне уявлення про реальний фінансовий стан компанії. Забезпечує керування бізнесом через цифри, планування, рішення, дозволяє контролювати прибутковість і витрати та приймати обґрунтовані управлінські рішення, а не діяти інтуїтивно.' },
  { key: 'commercial', name: 'Комерційний контур', parent: null, purpose: 'Сформовані і керовані канали продажів, які забезпечують стабільну, прогнозовану і зростаючу виручку.' },
  { key: 'export', name: 'Експортний контур', parent: null, purpose: 'Стабільно зростаюча виручка в міжнародних ринках через вибудувані партнерства та канали продажів за межами України.' },
  { key: 'ops', name: 'Операційний контур', parent: null, purpose: 'Керована операційна система компанії, яка забезпечує виробництво, логістику і виконання замовлень вчасно, якісно і з контрольованою собівартістю.' },
  { key: 'ops_production', name: 'Виробництво', parent: 'ops', purpose: '' },
  { key: 'ops_logistics', name: 'Логістика', parent: 'ops', purpose: '' },
  { key: 'ops_tech', name: 'Технічний відділ', parent: 'ops', purpose: '' }
];

export const POSITIONS = [
  // -- Адміністративний контур --
  { key: 'owner', title: 'Власник компанії', department: 'admin', reports_to: null,
    purpose: 'Сформована стратегія розвитку Fresh Black, визначені ключові напрямки зростання, збалансована бізнес-модель (продукт – бренд – фінанси), та прийняті стратегічні рішення, які забезпечують масштабування компанії без операційної залежності від власника.',
    employee: { full_name: 'Шраменко Віктор Юрійович', employee_number: '', telegram: '', employment_type: '' } },
  { key: 'ceo', title: 'CEO / Загальне управління', department: 'admin', reports_to: 'owner',
    purpose: 'Керована, узгоджена і стабільно працююча компанія, в якій всі відділення мають цілі, зони відповідальності і виконують свої функції, а результати компанії досягаються системно, а не через ручне управління.',
    status: 'Recruitment Active', note: 'За Miro-схемою тимчасово виконує власник, Шраменко Віктор — офіційно роль відкрита вакансія.' },
  { key: 'lawyer', title: 'Юрист', department: 'admin', reports_to: 'ceo',
    purpose: 'Юридично захищена діяльність компанії та мінімізовані правові ризики.',
    employee: { full_name: 'Брагінська Анна', employee_number: '', telegram: '', employment_type: '' } },

  // -- Контур управління персоналом --
  { key: 'hrd', title: 'HRD (керівник відділення персоналу)', department: 'hr', reports_to: 'ceo',
    purpose: 'Вибудувана та відтворювана система роботи з персоналом, що забезпечує компанію потрібними людьми, їх адаптацію, розвиток і утримання.',
    employee: { full_name: 'Сваволя Тетяна Євгеніївна', employee_number: 'FB000152', telegram: '357796447', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'recruiter', title: 'Recruiter (Рекрутинг)', department: 'hr', reports_to: 'hrd',
    purpose: 'Своєчасно закриті вакансії відповідними за компетенціями співробітниками.',
    employee: { full_name: 'Рижа Анастасія Володимирівна', employee_number: 'FB000183', telegram: '453075477', employment_type: '' } },
  { key: 'adaptation_learning', title: 'Адаптація та навчання персоналу', department: 'hr', reports_to: 'hrd',
    purpose: 'Співробітники, які розуміють свої обов’язки, стандарти роботи і здатні самостійно виконувати свої функції.',
    status: 'Vacant', note: 'За Miro-схемою тимчасово виконує HRD (Сваволя Тетяна).' },

  // -- Фінансовий контур --
  { key: 'cfo', title: 'CFO (Outsource)', department: 'finance', reports_to: 'ceo',
    purpose: 'Фінансова модель і контроль, що забезпечують керованість бізнесу, планування та контроль прибутковості.',
    status: 'Vacant', note: 'За Miro-схемою тимчасово виконує власник, Шраменко Віктор.' },
  { key: 'fin_manager', title: 'Фінансовий менеджер', department: 'finance', reports_to: 'cfo',
    purpose: 'Сформована та підтримувана управлінська фінансова система Fresh Black: достовірні управлінські звіти (P&L, Cash Flow, Balance), фінансове планування та прогнозування, контроль ефективності, рентабельності та робочого капіталу, аналітика для прийняття управлінських рішень власником, а також підготовка фінансових обґрунтувань для залучення фінансування та розвитку компанії.',
    employee: { full_name: 'Бородіна Наталія Олександрівна', employee_number: 'FB000133', telegram: '406593230', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'chief_accountant', title: 'Головний бухгалтер', department: 'finance', reports_to: 'cfo',
    purpose: 'Коректний і своєчасний бухгалтерський та податковий облік, безпечна звітність, мінімізація ризиків штрафів і відповідність вимогам законодавства.',
    employee: { full_name: 'Максименко Альона Володимирівна', employee_number: 'FB00059', telegram: '465734268', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'accountant_bank', title: 'Бухгалтер з банківських операцій', department: 'finance', reports_to: 'chief_accountant',
    purpose: 'Коректно проведені банківські операції, актуальні залишки коштів та точний облік руху грошових коштів.',
    employee: { full_name: 'Кулікова Ірина', employee_number: 'FB0000164', telegram: '1141603615', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'accountant_primary', title: 'Бухгалтер з первинної документації', department: 'finance', reports_to: 'chief_accountant',
    purpose: 'Коректно оформлена, перевірена та своєчасно внесена первинна документація без помилок і затримок.',
    employee: { full_name: 'Задорожня-Кожадуб Анна Олегівна', employee_number: 'FB000120', telegram: '636728022', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'accountant_production', title: 'Бухгалтер з виробництва та експортних документів', department: 'finance', reports_to: 'chief_accountant',
    purpose: 'Коректний облік виробничих операцій і собівартості, що дозволяє компанії контролювати рентабельність продуктів.',
    employee: { full_name: 'Сіденко Яна Василівна', employee_number: 'FB000103', telegram: '745026863', employment_type: 'ТОВ "ФУД ВОРКС"' } },

  // -- Комерційний контур --
  { key: 'commercial_director', title: 'Комерційний директор', department: 'commercial', reports_to: 'ceo',
    purpose: 'Сформована і керована комерційна система Fresh Black, яка об’єднує маркетинг і продажі (B2B, Retail, Distribution), забезпечує стабільний потік клієнтів і формує прогнозовану, зростаючу виручку, яка масштабується без ручного управління.',
    status: 'Vacant', note: 'За Miro-схемою тимчасово виконує власник, Шраменко Віктор.' },
  { key: 'b2b_head', title: 'Керівник відділення продажів (B2B)', department: 'commercial', reports_to: 'commercial_director',
    purpose: 'Стабільна та зростаюча виручка B2B-напрямку через керовану команду менеджерів та виконання плану продажів.',
    status: 'Vacant', note: 'За Miro-схемою: Корнієнко Андрій — цієї людини немає в переліку співробітників, уточни, чи вона в штаті.' },
  { key: 'sales_ops_coordinator', title: 'Sales Operations Coordinator', department: 'commercial', reports_to: 'b2b_head',
    purpose: 'Прозора, керована система продажів, у якій всі взаємовідносини, дані та угоди коректні, CRM і пов’язані системи працюють стабільно, а керівництво має повну й достовірну картину по продажах.',
    employee: { full_name: 'Кириченко Юрій Валерійович', employee_number: 'FB001000', telegram: '566510555', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'sales_ops_assistant', title: 'Sales Operations Assistant / Secretary', department: 'commercial', reports_to: 'sales_ops_coordinator',
    purpose: 'Операційна підтримка та актуалізація у структурованих операційних таблицях, підготовка інформації для перенесення в CRM та допомога відділу Retail в оформленні замовлень.',
    status: 'Vacant', note: 'Відкрита посада або можлива посада (за Miro-схемою).' },
  { key: 'b2b_manager_1', title: 'Менеджер B2B', department: 'commercial', reports_to: 'b2b_head',
    purpose: 'Сформована та зростаюча база B2B-партнерів Fresh Black у сегменті HoReCa, з якими вибудувані довгострокові відносини і які здійснюють регулярні повторні закупівлі продукції.',
    employee: { full_name: 'Довгий Ілля Олегович', employee_number: 'FB000128', telegram: '905586834', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'b2b_manager_2', title: 'Менеджер B2B', department: 'commercial', reports_to: 'b2b_head',
    purpose: '',
    employee: { full_name: 'Соловей Іван Яковлевич', employee_number: 'FB0000163', telegram: '432536246', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'b2b_manager_3', title: 'Менеджер B2B', department: 'commercial', reports_to: 'b2b_head',
    purpose: '',
    employee: { full_name: 'Маковський Іван Володимирович', employee_number: 'FB000167', telegram: '775682421', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'b2b_manager_kyiv1', title: 'Менеджер B2B Київ', department: 'commercial', reports_to: 'b2b_head', purpose: '', status: 'Vacant' },
  { key: 'b2b_manager_kyiv2', title: 'Менеджер B2B Київ', department: 'commercial', reports_to: 'b2b_head', purpose: '', status: 'Vacant' },
  { key: 'b2b_manager_west', title: 'Менеджер B2B (Зах. рег.)', department: 'commercial', reports_to: 'b2b_head', purpose: '', status: 'Vacant' },
  { key: 'b2b_ops_coordinator', title: 'Координатор із операційної підтримки B2B', department: 'commercial', reports_to: 'b2b_head',
    purpose: 'Коректно оформлені та супроводжені замовлення B2B і Retail-клієнтів від моменту прийому до моменту відвантаження, з повним і актуальним пакетом документів та актуальними даними в системах.',
    employee: { full_name: 'Гончар Ірина Миколаївна', employee_number: 'FB000117', telegram: '388665239', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'retail_head', title: 'Head of Retail / PL / Distribution', department: 'commercial', reports_to: 'commercial_director',
    purpose: 'Регулярна виручка з Retail, Private Label та за допомогою дистриб’юторів через розвиток партнерств і контрактів.',
    employee: { full_name: 'Капран Євген Володимирович', employee_number: 'FB000127', telegram: '1086270631', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'kam', title: 'KAM (Менеджер Retail)', department: 'commercial', reports_to: 'retail_head',
    purpose: '',
    employee: { full_name: 'Пастернак Євгеній Євгенійович', employee_number: 'FB0000166', telegram: '248687155', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'regional_manager', title: 'Регіональний менеджер / дистриб’ютор', department: 'commercial', reports_to: 'retail_head', purpose: '', status: 'Vacant' },
  { key: 'comm_pr', title: 'Comm/PR', department: 'commercial', reports_to: 'commercial_director',
    purpose: '',
    employee: { full_name: 'Арнова Анастасія Сергіївна', employee_number: '', telegram: '', employment_type: 'ФОП' } },
  { key: 'smm_content', title: 'SMM / Content', department: 'commercial', reports_to: 'comm_pr', purpose: 'Регулярна і жива комунікація бренду, яка формує інтерес і довіру до продукту.', status: 'Vacant' },
  { key: 'videographer', title: 'Відеограф', department: 'commercial', reports_to: 'comm_pr', purpose: '', status: 'Vacant' },
  { key: 'customer_experience', title: 'Customer Experience / Digital Support', department: 'commercial', reports_to: 'comm_pr', purpose: 'Швидка і якісна обробка звернень клієнта, яка підсилює конверсію і утримання.', status: 'Vacant' },
  { key: 'copywriter', title: 'Copywriter (freelance)', department: 'commercial', reports_to: 'comm_pr', purpose: 'Тексти, які підсилюють цінність продукту і підтримують продажі.', status: 'Vacant' },
  { key: 'art_designer', title: 'Арт-дизайнер (freelance)', department: 'commercial', reports_to: 'comm_pr', purpose: 'Візуальні матеріали, які підсилюють бренд і комерційний маркетинг.', status: 'Vacant' },
  { key: 'designers', title: 'Designers (freelance)', department: 'commercial', reports_to: 'comm_pr', purpose: 'Візуальні матеріали, які підсилюють бренд і комерційний маркетинг.', status: 'Vacant' },
  { key: 'digital_marketing', title: 'Digital / Growth Marketing Manager', department: 'commercial', reports_to: 'commercial_director',
    purpose: 'Стабільний потік людей і клієнтів через digital-канали (PPC, SEO, сайт, аналітика), який конвертується в продажі.',
    employee: { full_name: 'Вова Вадим Васильович', employee_number: '', telegram: '', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'marketing_specialist', title: 'Фахівець з методів розширення ринку збуту (маркетолог)', department: 'commercial', reports_to: 'commercial_director',
    purpose: '',
    employee: { full_name: 'Соколова Яна', employee_number: '', telegram: '', employment_type: 'ТОВ "ФУД ВОРКС"' } },

  // -- Експортний контур --
  { key: 'export_head', title: 'Head of Export', department: 'export', reports_to: 'ceo',
    purpose: 'Стабільна та зростаюча виручка в експортних ринках, вибудувані партнерства та масштабування Fresh Black за межами України.',
    employee: { full_name: 'Полтавець Ксенія Андріївна', employee_number: '', telegram: '', employment_type: 'ТОВ "НУАРЕ"' },
    note: 'Немає в переліку співробітників як окремий рядок — відома з поля "Директор" у логістиці/техвідділі, employee_id уточни.' },

  // -- Операційний контур --
  { key: 'coo', title: 'COO / Operations Director', department: 'ops', reports_to: 'ceo',
    purpose: 'Стабільна операційна діяльність (виробництво, логістика і склад), яка підтримує всі канали продажів і масштабується без втрати якості.',
    employee: { full_name: 'Скок Олександр Олександрович', employee_number: 'FB0002', telegram: '614681765', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'procurement', title: 'Закупівельник', department: 'ops', reports_to: 'coo', purpose: '', status: 'Vacant' },

  { key: 'production_head', title: 'Керівник виробництва', department: 'ops_production', reports_to: 'coo',
    purpose: 'Стабільне виробництво кавових продуктів Fresh Black (обсмажка та фасування) відповідно до стандартів якості, забезпечує стабільність обсягів між партіями у запланованому обсязі і з контрольованою собівартістю.',
    employee: { full_name: 'Кузнєцов Олексій Валентинович', employee_number: 'FB000160', telegram: '364771002', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'senior_roaster', title: 'Старший обсмажчик / контролер якості кави', department: 'ops_production', reports_to: 'production_head',
    purpose: '',
    employee: { full_name: 'Нападій Владислав Ігорович', employee_number: 'FB000398', telegram: '627240878', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'roaster', title: 'Обсмажчик', department: 'ops_production', reports_to: 'senior_roaster',
    purpose: '',
    employee: { full_name: 'Лобурєв Дмитро Павлович', employee_number: 'FB000170', telegram: '387073198', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'packer_1', title: 'Фасувальник', department: 'ops_production', reports_to: 'senior_roaster', purpose: '',
    employee: { full_name: 'Яковлєв Андрій Костянтинович', employee_number: 'FB00017', telegram: '5233262658', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'packer_2', title: 'Фасувальник', department: 'ops_production', reports_to: 'senior_roaster', purpose: '',
    employee: { full_name: 'Коваленко Сергій Анатолійович', employee_number: 'FB00155', telegram: '5267907930', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'packer_3', title: 'Фасувальник', department: 'ops_production', reports_to: 'senior_roaster', purpose: '',
    employee: { full_name: 'Коваль Катерина Вячеславівна', employee_number: 'FB0000165', telegram: '1651852061', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'packer_4', title: 'Фасувальник', department: 'ops_production', reports_to: 'senior_roaster', purpose: '',
    employee: { full_name: 'Коваль Тетяна Сергіївна', employee_number: 'FB000168', telegram: '961055672', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'packer_5', title: 'Фасувальник', department: 'ops_production', reports_to: 'senior_roaster', purpose: '',
    employee: { full_name: 'Климчук Ірина Вікторівна', employee_number: 'FB00169', telegram: '1923524038', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'packer_6', title: 'Фасувальник', department: 'ops_production', reports_to: 'senior_roaster', purpose: '',
    employee: { full_name: 'Капінус Дмитро Сергійович', employee_number: 'FB001266', telegram: '923519843', employment_type: 'Неофіційно' } },
  { key: 'rd_technologist', title: 'R&D / Технолог', department: 'ops_production', reports_to: 'production_head',
    purpose: '',
    employee: { full_name: 'Колінченко Юлія Петрівна', employee_number: 'FB00Tehnolog', telegram: '1104236578', employment_type: 'Неофіційно' } },
  { key: 'line_operator_1', title: 'Оператор лінії', department: 'ops_production', reports_to: 'rd_technologist', purpose: '', status: 'Vacant' },
  { key: 'line_operator_2', title: 'Оператор лінії', department: 'ops_production', reports_to: 'rd_technologist', purpose: '', status: 'Vacant' },
  { key: 'rd_packer', title: 'Фасувальник', department: 'ops_production', reports_to: 'rd_technologist', purpose: '', status: 'Vacant' },
  { key: 'storekeeper', title: 'Комірник', department: 'ops_production', reports_to: 'production_head',
    purpose: '', note: 'Можливо цю людину будемо замінювати (позначено на Miro-схемі).',
    employee: { full_name: 'Фомченко Олександр Адамович', employee_number: 'FB000172', telegram: '853721003', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'loader', title: 'Вантажник', department: 'ops_production', reports_to: 'storekeeper', purpose: '', status: 'Vacant' },
  { key: 'cleaner', title: 'Прибиральниця', department: 'ops_production', reports_to: 'production_head',
    purpose: 'Чисте робоче середовище, яке дозволяє команді працювати ефективно.',
    employee: { full_name: 'Чичва Тетяна Валентинівна', employee_number: 'FB00180', telegram: '8954849624', employment_type: 'ТОВ "ФУД ВОРКС"' } },

  { key: 'logistics_lead', title: 'Логіст', department: 'ops_logistics', reports_to: 'coo',
    purpose: '',
    employee: { full_name: 'Майданік Святослав Петрович', employee_number: 'FB00072', telegram: '1026620679', employment_type: 'ТОВ "ФУД ВОРКС", ТОВ "НУАРЕ"' } },
  { key: 'driver_1', title: 'Водій', department: 'ops_logistics', reports_to: 'logistics_lead', purpose: '',
    employee: { full_name: 'Драник Максим Михайлович', employee_number: 'FB000149', telegram: '', employment_type: 'ТОВ "ФУД ВОРКС", ТОВ "НУАРЕ"' } },
  { key: 'driver_2', title: 'Водій', department: 'ops_logistics', reports_to: 'logistics_lead', purpose: '',
    employee: { full_name: 'Кізько Олена Віталіївна', employee_number: '', telegram: '', employment_type: 'ФОП' } },
  { key: 'driver_3', title: 'Водій', department: 'ops_logistics', reports_to: 'logistics_lead', purpose: '',
    employee: { full_name: 'Кривенко Віталій Миколайович', employee_number: 'FB000150', telegram: '', employment_type: 'ТОВ "ФУД ВОРКС", ТОВ "НУАРЕ"' } },

  { key: 'quality_brand_barista', title: 'Шеф бренд-бариста / директор з якості', department: 'ops_tech', reports_to: 'coo',
    purpose: '',
    employee: { full_name: 'Невінчаний Володимир Вікторович', employee_number: 'FB00069', telegram: '413946267', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'technician_1', title: 'Технік', department: 'ops_tech', reports_to: 'quality_brand_barista', purpose: '',
    employee: { full_name: 'Префонтейн Віктор Вікторович', employee_number: 'FB000146', telegram: '8730202810', employment_type: 'ТОВ "ФУД ВОРКС"' } },
  { key: 'technician_2', title: 'Технік', department: 'ops_tech', reports_to: 'quality_brand_barista', purpose: '',
    employee: { full_name: 'Удод Денис Євгенійович', employee_number: 'FB000106', telegram: '679202523', employment_type: 'ТОВ "НУАРЕ"' } },
  { key: 'technician_3', title: 'Технік', department: 'ops_tech', reports_to: 'quality_brand_barista', purpose: '',
    employee: { full_name: 'Нефьодов Ілля Іванович', employee_number: 'FB000145', telegram: '1154117400', employment_type: '' } }
];

// Департаменти, які створив попередній (помилковий, плоский) імпорт —
// видаляються каскадно перед новим імпортом, щоб не лишати дублів/сміття.
export const LEGACY_TOP_LEVEL_DEPARTMENTS = [
  'Фінансовий відділ', 'Комерційний відділ', 'Виробництво', 'Рітейл',
  'Маркетинг та PR', 'Технічний відділ', 'Логістика', 'Адміністрація'
];
