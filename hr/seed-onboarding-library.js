// Бібліотека шаблонів онбординг-задач Fresh Black — імпортовано з
// Employee_journey_map.xlsx (аркуш TASKS_LIBRARY), розділи "Pre-onboarding"
// і "Onboarding" (190 рядків з 943 у файлі — решта аркуша описує наступні
// етапи життєвого циклу співробітника: Performance/Development/Retention/
// Offboarding, які вже покриті окремими існуючими модулями застосунку, не
// цим онбординг-чеклистом). Застосовується ідемпотентно при кожному старті
// сервера (seedOnboardingLibrary у db.js, за принципом seed-org-import.js)
// — за збігом (scope, milestone, title) не плодить дублі, тож Тетяна може
// вільно редагувати/видаляти окремі шаблони через інтерфейс "Бібліотека
// шаблонів задач", повторний імпорт їх не поверне.
//
// due_offset_days виведено з підетапу (Підетап у файлі: Pre-onboarding/
// Day 1/Week 1/14/30/60/90 днів), а не з колонки "Дедлайн" — вона в
// оригінальному файлі містить биті формули (#ERROR!/#VALUE!/#NAME?) для
// більшості рядків Onboarding-етапу, невикористовний як джерело точної
// дати; підетап натомість дає надійний, однозначний бакет.
//
// department — не department_id (може відрізнятись між середовищами), а
// реальна назва контуру з оргструктури, резолвиться в id при застосуванні.
// Категорія "Marketing" з файлу навмисно лишена без department (scope
// Company) — окремого контуру маркетингу в реальній оргструктурі компанії
// нема (є лише ролі всередині Комерційного контуру), а призначити
// маркетинг-задачі не тому департаменту гірше, ніж лишити їх
// компанія-широкими.

export const ONBOARDING_LIBRARY = [
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Надіслати welcome-лист",
    "description": "Вітання, підтвердження виходу, структура першого дня\n\nОчікуваний результат: Співробітник знає план старту",
    "owner_role": "HR / Керівник",
    "due_offset_days": -3,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Надсилання інформаційного пакету",
    "description": "Місія, цінності, правила, контакти, графік, карта офісу\n\nОчікуваний результат: Співробітник розуміє контекст компанії",
    "owner_role": "HR",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Надати доступи",
    "description": "Gmail, Drive, Calendar, Telegram, корпоративні канали\n\nОчікуваний результат: Повна технічна готовність",
    "owner_role": "IT/HR",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Додати у корпоративні чати",
    "description": "“Fresh Black News”, “HR Info”, віддільні чати\n\nОчікуваний результат: Співробітник включений у комунікацію",
    "owner_role": "HR",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Підготовка робочого місця",
    "description": "Стіл, техніка, меблі, матеріали\n\nОчікуваний результат: Місце готове",
    "owner_role": "Офіс-менеджер",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Підготовка техніки",
    "description": "Ноутбук, зарядка, налаштування\n\nОчікуваний результат: Техніка повністю готова",
    "owner_role": "IT",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Створити робочий обліковий запис",
    "description": "Gmail + підключення до Drive, Sheets, Meet\n\nОчікуваний результат: Співробітник може працювати",
    "owner_role": "IT",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Підготувати пропуск / ключ карту",
    "description": "У разі потреби\n\nОчікуваний результат: Фізичний доступ організовано",
    "owner_role": "Адміністратор",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Надати правила та політики",
    "description": "Положення, командні правила, структура\n\nОчікуваний результат: Зрозумілі очікування",
    "owner_role": "HR",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Створити адаптаційну картку",
    "description": "EMPLOYEE_CARD для ролі\n\nОчікуваний результат: Повний чеклист готовий",
    "owner_role": "HR",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Надати доступ до SAP Business One",
    "description": "Попередньо створити роль, підтягнути права\n\nОчікуваний результат: Може працювати з даними",
    "owner_role": "IT + Фіндир",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Підготувати доступи до CRM (ZOHO)",
    "description": "Для Sales Ops, економістів, фінменеджерів\n\nОчікуваний результат: Готовність до обліку",
    "owner_role": "IT",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Підготувати шаблони звітності",
    "description": "P&L, CF, BS, Sales Reports, дебіторка\n\nОчікуваний результат: Новачок приходить з набором інструментів",
    "owner_role": "Фінменеджер / Економіст",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Створити структуру доступу до фінпапок",
    "description": "Google Drive → Finance / Templates / Processes\n\nОчікуваний результат: Системний старт",
    "owner_role": "Фіндир",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Надати доступ до соцмереж",
    "description": "Instagram, Facebook, LinkedIn, YouTube\n\nОчікуваний результат: Повний доступ",
    "owner_role": "Marketing Lead",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Надати доступ до рекламних кабінетів",
    "description": "Meta Ads, Google Ads, TikTok Ads (якщо є)\n\nОчікуваний результат: Можливість запуску кампаній",
    "owner_role": "Digital Coordinator",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Передати брендбук",
    "description": "Логотипи, шрифти, tone of voice\n\nОчікуваний результат: Розуміння стилю",
    "owner_role": "PR / Marketing Lead",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Передати контент-план",
    "description": "Google Sheet з планом на місяць\n\nОчікуваний результат: Знання формату",
    "owner_role": "SMM",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Передати доступи до CRM",
    "description": "Zoho CRM (якщо взаємодія з клієнтами)\n\nОчікуваний результат: CRM-ready",
    "owner_role": "Sales Ops",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Передати основні KPI",
    "description": "Охоплення, ER, CTR, CPA, ROI\n\nОчікуваний результат: Зрозумілі очікування",
    "owner_role": "Marketing Lead",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Надати доступ до CRM Zoho",
    "description": "Створити роль, pipeline, поля\n\nОчікуваний результат: Може вести клієнтів",
    "owner_role": "Sales Ops Coordinator",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Надати доступ до SAP",
    "description": "Контрагенти, дебіторка\n\nОчікуваний результат: Може оформляти документи",
    "owner_role": "IT + Бухгалтерія",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Передати прайс-лист",
    "description": "Актуальна версія від Sales Ops\n\nОчікуваний результат: Розуміння продуктів",
    "owner_role": "Sales Ops",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Передати презентацію компанії",
    "description": "Fresh Black презентація для клієнтів\n\nОчікуваний результат: Матеріали для зустрічей",
    "owner_role": "Commercial Director",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Передати технічні матеріали",
    "description": "Асортимент кави, обладнання, терміни\n\nОчікуваний результат: Знання продукту",
    "owner_role": "B2B Lead",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Передати план продажів",
    "description": "Місячний/квартальний план\n\nОчікуваний результат: Зрозуміла мета",
    "owner_role": "Commercial Director",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Підготувати форму",
    "description": "Уніформа, правила носіння\n\nОчікуваний результат: Працівник готовий фізично",
    "owner_role": "Керівник виробництва",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Підготувати інструменти",
    "description": "Лінія фасування, матеріали\n\nОчікуваний результат: Повна техготовність",
    "owner_role": "Старший фасувальник",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Передати HACCP інструкції",
    "description": "Контрольні карти, вимоги\n\nОчікуваний результат: Знання стандартів",
    "owner_role": "Керівник виробництва",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Надати правила безпеки",
    "description": "TB, охорона праці\n\nОчікуваний результат: Безпечний старт",
    "owner_role": "HR + Production Lead",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "Day 1 / Week 1",
    "title": "Підготувати адаптаційні чеклисти",
    "description": "14–30–60–90\n\nОчікуваний результат: Готова система",
    "owner_role": "HRD",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "Day 1 / Week 1",
    "title": "Підготувати карту комунікацій",
    "description": "Команди, ролі, фото\n\nОчікуваний результат: Орієнтація співробітника",
    "owner_role": "HRD",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "Day 1 / Week 1",
    "title": "Підготувати політики",
    "description": "Файли цінностей, правил, процесів\n\nОчікуваний результат: Прозорість процесів",
    "owner_role": "HRD",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "Day 1 / Week 1",
    "title": "Перевірити доступи для всіх ролей",
    "description": "Google, SAP, CRM\n\nОчікуваний результат: Технічна готовність",
    "owner_role": "HRD",
    "due_offset_days": -1,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Welcome-зустріч від HR",
    "description": "Привітання, базовий план дня, підтримка\n\nОчікуваний результат: Співробітник орієнтований",
    "owner_role": "HR",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Тур офісом / виробництвом",
    "description": "Кухня, туалети, склади, кав'ярня, виробництво\n\nОчікуваний результат: Співробітник знає простір",
    "owner_role": "HR / Адмін",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Знайомство з командою",
    "description": "Презентація у командному чаті або особисто\n\nОчікуваний результат: Перше соціальне включення",
    "owner_role": "Керівник / HR",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Представлення Buddy",
    "description": "Визначити контактну особу на 30 днів\n\nОчікуваний результат: Підтримка забезпечена",
    "owner_role": "HR",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Бриф по компанії",
    "description": "Місія, цінності, що виробляємо, структура команди\n\nОчікуваний результат: Розуміння компанії",
    "owner_role": "HRD",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з правилами",
    "description": "Як працюємо, комунікація, графік, відпустки\n\nОчікуваний результат: Розуміння процесів",
    "owner_role": "HR",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Навчання технічним інструментам",
    "description": "Google, чати, корпоративні канали\n\nОчікуваний результат: Може працювати з системами",
    "owner_role": "Buddy / HR",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Знайомство з маркетинг командою",
    "description": "SMM, відеограф, дизайнер, PR\n\nОчікуваний результат: Інтеграція",
    "owner_role": "Marketing TL",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Знайомство зі стратегічним контент-планом",
    "description": "Огляд контенту на місяць\n\nОчікуваний результат: Розуміння задач",
    "owner_role": "SMM",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Огляд рекламних акаунтів",
    "description": "Meta, Google\n\nОчікуваний результат: Доступи працюють",
    "owner_role": "Digital",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомитися з брендбуком",
    "description": "Тон, кольори, візуал\n\nОчікуваний результат: Розуміння стилю",
    "owner_role": "PR",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Знайомство з Sales командою",
    "description": "KAM, Sales Ops, B2B\n\nОчікуваний результат: Командна інтеграція",
    "owner_role": "Commercial Director",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Огляд CRM Zoho",
    "description": "Pipeline, статуси, поля\n\nОчікуваний результат: Вміє працювати з CRM",
    "owner_role": "Sales Ops",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Огляд продуктового портфелю",
    "description": "SKU, сорти, обладнання\n\nОчікуваний результат: Базове знання продукту",
    "owner_role": "B2B Lead",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Огляд процесів документообігу",
    "description": "Договір, акти, дебіторка\n\nОчікуваний результат: Розуміння процесів",
    "owner_role": "Бухгалтерія",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Знайомство з фінкомандою",
    "description": "Фіндир, економіст, бухгалтери\n\nОчікуваний результат: Командна інтеграція",
    "owner_role": "Finance Director",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Огляд SAP Business One",
    "description": "Базова навігація\n\nОчікуваний результат: Може працювати в системі",
    "owner_role": "Фінменеджер",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Огляд шаблонів звітності",
    "description": "P&L, CF, Sales\n\nОчікуваний результат: Розуміння структури",
    "owner_role": "Економіст",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з регламентами",
    "description": "Порядок формування фінзвітів\n\nОчікуваний результат: Розуміння процесів",
    "owner_role": "Finance Director",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Знайомство з виробничою командою",
    "description": "Майстер, старший фасувальник\n\nОчікуваний результат: Соціальна інтеграція",
    "owner_role": "Production Lead",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Огляд лінії фасування",
    "description": "Техніка, регулятори, безпека\n\nОчікуваний результат: Базове розуміння роботи",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Навчання ТБ і HACCP",
    "description": "Правила чистоти, гігієни\n\nОчікуваний результат: Розуміння вимог",
    "owner_role": "Production Lead",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з планом дня",
    "description": "Розподіл змін, норми часу\n\nОчікуваний результат: Старт роботи",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "Day 1 / Week 1",
    "title": "Передати чеклист адаптації новачку",
    "description": "Пояснити структуру 14–30–60–90\n\nОчікуваний результат: Співробітник розуміє систему",
    "owner_role": "HRD",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "Day 1 / Week 1",
    "title": "Провести коротку презентацію процесів",
    "description": "Onboarding, комунікація, політики\n\nОчікуваний результат: Орієнтація",
    "owner_role": "HRD",
    "due_offset_days": 0,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "1:1 з керівником",
    "description": "Обговорення ролі, очікувань, цілей на місяць\n\nОчікуваний результат: Чіткі очікування",
    "owner_role": "Керівник",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Огляд корпоративних політик",
    "description": "Відпустки, лікарняні, комунікації\n\nОчікуваний результат: Розуміння правил",
    "owner_role": "HR",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Огляд внутрішніх систем",
    "description": "Gmail, Drive, чати, процеси\n\nОчікуваний результат: Вміє користуватись",
    "owner_role": "Buddy / HR",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з командними процесами",
    "description": "Як працює відділ, щотижневі мітинги\n\nОчікуваний результат: Інтеграція",
    "owner_role": "Керівник",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Shadowing (спостереження)",
    "description": "1–2 години за колегою\n\nОчікуваний результат: Розуміння операцій",
    "owner_role": "Buddy",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Перевірка знань першого тижня",
    "description": "Міні-квіз або усна перевірка\n\nОчікуваний результат: Перевірка розуміння",
    "owner_role": "Buddy / HR",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Участь у тижневому командному мітингу",
    "description": "Представити новачка\n\nОчікуваний результат: Командна інтеграція",
    "owner_role": "Керівник",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з брендбуком",
    "description": "Voice, tone, візуал\n\nОчікуваний результат: Розуміє стиль",
    "owner_role": "PR",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Огляд контент-плану",
    "description": "План на місяць, рубрики\n\nОчікуваний результат: Розуміє задачі",
    "owner_role": "SMM",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Аналіз конкурентів",
    "description": "5 конкурентів, SMM аналіз\n\nОчікуваний результат: Перший аналіз",
    "owner_role": "SMM",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Перше завдання на контент",
    "description": "Draft посту або Reels\n\nОчікуваний результат: Практичний старт",
    "owner_role": "SMM / TL",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з рекламними звітами",
    "description": "CPA, CTR, ROI\n\nОчікуваний результат: Розуміння рекламних каналів",
    "owner_role": "Digital Coordinator",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Огляд CRM Zoho детальний",
    "description": "Як створювати угоди, задачі, стани\n\nОчікуваний результат: Може вести клієнтів",
    "owner_role": "Sales Ops",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Вивчення асортименту",
    "description": "Огляд усіх SKU + дегустація\n\nОчікуваний результат: Знання продукту",
    "owner_role": "B2B Lead",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з типовим договором",
    "description": "Договір, акт, дебіторка\n\nОчікуваний результат: Розуміння документообігу",
    "owner_role": "Бухгалтерія",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Перше навчання з продажів",
    "description": "Опис скриптів, воронки\n\nОчікуваний результат: Навички продажів",
    "owner_role": "B2B Lead",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "Day 1 / Week 1",
    "title": "Підготовка презентації для клієнтів",
    "description": "Тренувальне відпрацювання\n\nОчікуваний результат: Перше відпрацювання",
    "owner_role": "Керівник",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з SAP у глибині",
    "description": "Налаштування, проведення документів\n\nОчікуваний результат: Вміє працювати самостійно",
    "owner_role": "Фінменеджер",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення зі звітністю",
    "description": "P&L, CF, Sales, BS\n\nОчікуваний результат: Розуміє логіку",
    "owner_role": "Економіст",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з регламентами",
    "description": "Регламент закриття місяця\n\nОчікуваний результат: Розуміння процесу",
    "owner_role": "Фіндиректор",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Навчання роботі на фасувальній лінії",
    "description": "Основні режими роботи\n\nОчікуваний результат: Розуміння техніки",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Огляд HACCP",
    "description": "Критичні точки контролю\n\nОчікуваний результат: Безпека",
    "owner_role": "Production Lead",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "Day 1 / Week 1",
    "title": "Shadowing на зміні",
    "description": "Супровід працівника\n\nОчікуваний результат: Розуміння ритму",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення зі структурою процесів",
    "description": "Карта HR-процесів\n\nОчікуваний результат: Розуміння системи",
    "owner_role": "HRD",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "Day 1 / Week 1",
    "title": "Ознайомлення з політиками",
    "description": "Огляд ключових документів\n\nОчікуваний результат: Орієнтація",
    "owner_role": "HRD",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "Day 1 / Week 1",
    "title": "Shadowing від HRD",
    "description": "Як проводити зустрічі\n\nОчікуваний результат: Навички HR",
    "owner_role": "HRD",
    "due_offset_days": 5,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Checkpoint 14 днів (HR)",
    "description": "Оцінити: адаптація, швидкість навчання, емоційний стан\n\nОчікуваний результат: Звіт 14 днів",
    "owner_role": "HR",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Checkpoint 14 днів (керівник)",
    "description": "Оцінити: якість перших задач, самостійність, комунікації\n\nОчікуваний результат: Фідбек для HR",
    "owner_role": "Керівник",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Опитувальник 14 днів",
    "description": "Анонімна форма: як пройшли перші 2 тижні\n\nОчікуваний результат: Дані для адаптації",
    "owner_role": "HR",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Уточнення очікувань",
    "description": "HR + керівник уточнюють ролі та задачі\n\nОчікуваний результат: Корекція планів",
    "owner_role": "HR + Керівник",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Перевірка засвоєння інструментів",
    "description": "Gmail, Drive, чати, календар, внутрішні процеси\n\nОчікуваний результат: Може працювати без підтримки",
    "owner_role": "Buddy",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Огляд прогресу з Buddy",
    "description": "Що вийшло / що складно\n\nОчікуваний результат: Підтримка",
    "owner_role": "Buddy",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Перше міні-завдання від керівника",
    "description": "Невелике завдання щоб перевірити базові навички\n\nОчікуваний результат: Демонстрація компетенцій",
    "owner_role": "Керівник",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Перші контент-матеріали",
    "description": "2 пости + 1 Reels / чернетки\n\nОчікуваний результат: Базові навички контенту",
    "owner_role": "SMM",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Звіт по контенту",
    "description": "ER, охоплення, що зрозумів\n\nОчікуваний результат: Аналітичне мислення",
    "owner_role": "SMM",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Аналіз конкурентів",
    "description": "3 нових конкуренти\n\nОчікуваний результат: Розуміння ринку",
    "owner_role": "SMM",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Навчання рекламним системам",
    "description": "Meta / Google базовий огляд\n\nОчікуваний результат: Розуміння реклами",
    "owner_role": "Digital",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "14 days",
    "title": "Участь у маркетинг-мітингу",
    "description": "Щотижневий синк\n\nОчікуваний результат: Інтеграція",
    "owner_role": "Team Lead",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "14 days",
    "title": "Перші контакти з клієнтами (B2B)",
    "description": "Холодні дзвінки або листи (5–10)\n\nОчікуваний результат: Перевірка комунікації",
    "owner_role": "B2B Lead",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "14 days",
    "title": "Вивчення всього портфелю продуктів",
    "description": "Всіх SKU Fresh Black\n\nОчікуваний результат: Глибоке знання",
    "owner_role": "Sales Ops",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "14 days",
    "title": "Тренування презентації",
    "description": "Відпрацювання з керівником\n\nОчікуваний результат: Впевненість",
    "owner_role": "B2B Lead",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "14 days",
    "title": "Огляд CRM Analytics",
    "description": "Як читати конверсію, воронку\n\nОчікуваний результат: Розуміння процесів",
    "owner_role": "Sales Ops",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "14 days",
    "title": "Shadowing на зустрічах",
    "description": "1–2 виїзди з КАМ / B2B Lead\n\nОчікуваний результат: Практичний досвід",
    "owner_role": "Керівник",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "14 days",
    "title": "Самостійна робота в SAP",
    "description": "Проведення документів\n\nОчікуваний результат: Рівень «junior-ready»",
    "owner_role": "Фінменеджер",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "14 days",
    "title": "Підготовка першої mini-звітності",
    "description": "Таблиця + аналіз\n\nОчікуваний результат: Аналітичні навички",
    "owner_role": "Економіст",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "14 days",
    "title": "Ознайомлення з бюджетом",
    "description": "Структура витрат\n\nОчікуваний результат: Розуміння фінмоделі",
    "owner_role": "Фіндиректор",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "14 days",
    "title": "Робота під наглядом",
    "description": "3–5 змін з наставником\n\nОчікуваний результат: Рівень самостійності",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "14 days",
    "title": "Дотримання HACCP",
    "description": "Чітке виконання процедур\n\nОчікуваний результат: Безпечна робота",
    "owner_role": "Керівник виробництва",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "14 days",
    "title": "Перше самостійне завдання",
    "description": "Упаковка/фасування\n\nОчікуваний результат: Готовність",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "14 days",
    "title": "Провести аналіз перших 14 днів",
    "description": "Виявити «червоні зони»\n\nОчікуваний результат: Дані для адаптації",
    "owner_role": "HRD",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "14 days",
    "title": "Зустріч з керівником",
    "description": "Перевірка, чи потрібна підтримка\n\nОчікуваний результат: Координація",
    "owner_role": "HRD",
    "due_offset_days": 14,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "30-day Checkpoint (HR)",
    "description": "Підсумковий аналіз 1 місяця: навички, комунікації, темп навчання\n\nОчікуваний результат: 30-day звіт",
    "owner_role": "HR",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "30-day Checkpoint (керівник)",
    "description": "Оцінка результатів, якості перших задач, відповідальності\n\nОчікуваний результат: Рішення: ОК / корекція",
    "owner_role": "Керівник",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Оцінка культурної адаптації",
    "description": "Комунікації, командна інтеграція, співпраця\n\nОчікуваний результат: Дані про інтеграцію",
    "owner_role": "HR",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Опитувальник «30 днів у компанії»",
    "description": "Онлайн-форма: труднощі, пропозиції, потреби\n\nОчікуваний результат: Покращення системи",
    "owner_role": "HR",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Аналіз виконання задач 14–30 днів",
    "description": "Порівняти план фактом\n\nОчікуваний результат: Розуміння прогресу",
    "owner_role": "Керівник",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Оновлення плану адаптації",
    "description": "Новий план на 60 днів\n\nОчікуваний результат: Актуальні задачі",
    "owner_role": "HR + Керівник",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Перше самостійне велике завдання",
    "description": "Перше завдання без підтримки\n\nОчікуваний результат: Перевірка самостійності",
    "owner_role": "Керівник",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Підготовка 10–15 контент-одиниць",
    "description": "Пости, Reels, Stories, опис\n\nОчікуваний результат: Контент готовий за стандартом",
    "owner_role": "SMM",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Перший місячний звіт по SMM",
    "description": "CTR, ER, охоплення, динаміка\n\nОчікуваний результат: Аналітичний звіт",
    "owner_role": "SMM",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Звіт по рекламних кампаніях",
    "description": "ROI, CPA, CTR\n\nОчікуваний результат: Розуміння реклами",
    "owner_role": "Digital Coordinator",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Перша колабораційна пропозиція",
    "description": "Ідея + потенційні партнери\n\nОчікуваний результат: Креативність",
    "owner_role": "PR / TL",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "30 days",
    "title": "Ознайомлення з бренд-комунікацією Fresh Black",
    "description": "Приклади текстів, гайд стилю\n\nОчікуваний результат: Підвищення якості контенту",
    "owner_role": "PR",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "30 days",
    "title": "Перше закриття угоди / клієнта",
    "description": "Навіть невеликий → важлива практика\n\nОчікуваний результат: Практичний результат",
    "owner_role": "B2B Lead",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "30 days",
    "title": "Повний аналіз CRM",
    "description": "Пройтися по всіх статусах і процесах\n\nОчікуваний результат: Розуміння процесів",
    "owner_role": "Sales Ops",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "30 days",
    "title": "Огляд ключових клієнтів",
    "description": "Хто топ, хто ризиковий\n\nОчікуваний результат: Стратегічна орієнтація",
    "owner_role": "Commercial Director",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "30 days",
    "title": "10 холодних контактів + аналіз",
    "description": "Підготовка текстів і результатів\n\nОчікуваний результат: Оцінка техніки продажу",
    "owner_role": "B2B Lead",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "30 days",
    "title": "Огляд документів: договори, акти",
    "description": "Зрозуміти цикл документів\n\nОчікуваний результат: Адміністративна компетентність",
    "owner_role": "Бухгалтерія",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "30 days",
    "title": "Внутрішня презентація Fresh Black",
    "description": "Презентація команді\n\nОчікуваний результат: Комунікаційна навичка",
    "owner_role": "Sales Ops",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "30 days",
    "title": "Перше самостійне закриття дня у SAP",
    "description": "Проведення проводок, звірка\n\nОчікуваний результат: Технічна компетентність",
    "owner_role": "Фінменеджер",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "30 days",
    "title": "Підготовка mini P&L",
    "description": "Розуміння логіки доходів і витрат\n\nОчікуваний результат: Аналітична база",
    "owner_role": "Економіст",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "30 days",
    "title": "Огляд дебіторки",
    "description": "Зрозуміти проблемні точки\n\nОчікуваний результат: Фіндисципліна",
    "owner_role": "Фіндир",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "30 days",
    "title": "Ознайомлення з бюджетуванням",
    "description": "Структура, метод\n\nОчікуваний результат: Стратегічне розуміння",
    "owner_role": "Фіндир",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "30 days",
    "title": "Самостійне виконання змін",
    "description": "3–5 змін без помилок\n\nОчікуваний результат: Готовність",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "30 days",
    "title": "HACCP в роботі",
    "description": "Виконання процедур без нагадувань\n\nОчікуваний результат: Дотримання стандартів",
    "owner_role": "Production Lead",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "30 days",
    "title": "Контроль якості продукції",
    "description": "Візуальний огляд, пакування\n\nОчікуваний результат: Розуміння стандартів",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "30 days",
    "title": "Повний аналіз адаптації",
    "description": "Дані з HR, керівника, Buddy\n\nОчікуваний результат: Вироблення плану",
    "owner_role": "HRD",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "30 days",
    "title": "План розвитку на 60 днів",
    "description": "Нові задачі, корекція\n\nОчікуваний результат: Чітка стратегія",
    "owner_role": "HRD",
    "due_offset_days": 30,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "60-day Checkpoint (HR)",
    "description": "Оцінка прогресу: навички, відповідальність, швидкість\n\nОчікуваний результат: Звіт 60 днів",
    "owner_role": "HR",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "60-day Checkpoint (керівник)",
    "description": "Аналіз самостійності та результативності\n\nОчікуваний результат: Прогноз успішності",
    "owner_role": "Керівник",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "Перевірка включення в культуру",
    "description": "Комунікація, командна взаємодія\n\nОчікуваний результат: Рівень інтеграції",
    "owner_role": "HR",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "Участь у міжвіддільних процесах",
    "description": "Наприклад: зустріч з іншими відділами\n\nОчікуваний результат: Розуміння всієї системи",
    "owner_role": "Керівник",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "Повністю самостійне виконання задач",
    "description": "Без контролю Buddy\n\nОчікуваний результат: Самостійність",
    "owner_role": "Керівник",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "Корекція цілей на 90 днів",
    "description": "HR + керівник + новачок\n\nОчікуваний результат: Новий план",
    "owner_role": "HR/Керівник",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "Повний місячний контент-план",
    "description": "25–35 контент-одиниць\n\nОчікуваний результат: План готовий",
    "owner_role": "SMM",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "Перший повноцінний SMM-звіт",
    "description": "Всі показники: охоплення, ER, динаміка\n\nОчікуваний результат: Аналітичний звіт",
    "owner_role": "SMM",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "Підготовка рекламних рекомендацій",
    "description": "Оптимізації, аудиторії\n\nОчікуваний результат: Розуміння реклами",
    "owner_role": "Digital",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "Участь у 2+ колабораційних зустрічах",
    "description": "Пошук партнерів\n\nОчікуваний результат: Активність",
    "owner_role": "PR / TL",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "60 days",
    "title": "Перший контент-проект",
    "description": "Наприклад: серія stories/reels\n\nОчікуваний результат: Робота з циклом",
    "owner_role": "SMM",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "60 days",
    "title": "Регулярна робота з клієнтами",
    "description": "10+ дзвінків/зустрічей на тиждень\n\nОчікуваний результат: Системність",
    "owner_role": "B2B Lead",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "60 days",
    "title": "Перше закриття 2–3 угод",
    "description": "Навіть невеликі\n\nОчікуваний результат: Результат",
    "owner_role": "B2B Lead",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "60 days",
    "title": "CRM: аналіз своєї воронки",
    "description": "Конверсія, проблемні точки\n\nОчікуваний результат: Володіння CRM",
    "owner_role": "Sales Ops",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "60 days",
    "title": "Розуміння всього продуктового портфелю",
    "description": "Асортимент + обладнання\n\nОчікуваний результат: Глибокі знання",
    "owner_role": "Commercial Director",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "60 days",
    "title": "Підготовка клієнтської презентації",
    "description": "Самостійно\n\nОчікуваний результат: Комунікаційні навички",
    "owner_role": "Sales Ops",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "60 days",
    "title": "Повне самостійне ведення своїх ділянок",
    "description": "Без допомоги\n\nОчікуваний результат: Самостійність",
    "owner_role": "Фінменеджер",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "60 days",
    "title": "Підготовка місячної звітності",
    "description": "P&L mini, Cash Flow\n\nОчікуваний результат: Аналітична готовність",
    "owner_role": "Економіст",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "60 days",
    "title": "Розуміння процесів закриття місяця",
    "description": "Участь у закритті\n\nОчікуваний результат: Навички обліку",
    "owner_role": "Фіндир",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "60 days",
    "title": "Контроль дебіторки",
    "description": "Виявлення проблемних клієнтів\n\nОчікуваний результат: Управління грошима",
    "owner_role": "Фіндир",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "60 days",
    "title": "Повноцінна робота без спостереження",
    "description": "Зміна 6–8 годин\n\nОчікуваний результат: Самостійність",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "60 days",
    "title": "Дотримання HACCP без помилок",
    "description": "Щоденна перевірка\n\nОчікуваний результат: Стабільність",
    "owner_role": "Production Lead",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "60 days",
    "title": "Контроль якості",
    "description": "Фасування, герметичність, маркування\n\nОчікуваний результат: Якість продукції",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "60 days",
    "title": "Оцінка відповідності посаді",
    "description": "На основі KPI та прогресу\n\nОчікуваний результат: Прогноз успішності",
    "owner_role": "HRD",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "60 days",
    "title": "План розвитку на 90 днів",
    "description": "Новий план + корекції\n\nОчікуваний результат: Стратегія розвитку",
    "owner_role": "HRD",
    "due_offset_days": 60,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "90-day Checkpoint (HR)",
    "description": "Глибока оцінка прогресу: навички, поведінка, культура\n\nОчікуваний результат: Повний 90-day звіт",
    "owner_role": "HR",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "90-day Checkpoint (керівник)",
    "description": "Оцінка відповідності ролі, аналітика KPI\n\nОчікуваний результат: Рішення про успішність",
    "owner_role": "Керівник",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Оцінка KPI за 3 місяці",
    "description": "Обсяг задач, якість, швидкість\n\nОчікуваний результат: Прозора оцінка",
    "owner_role": "Керівник",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Оцінка культурної відповідності",
    "description": "Взаємодія, комунікація, поведінка\n\nОчікуваний результат: «Fit / No fit»",
    "owner_role": "HR",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Зустріч HR + Керівник + Новачок",
    "description": "Фінальна зустріч з результатами\n\nОчікуваний результат: Фінальне рішення",
    "owner_role": "HR",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Формування Development Plan",
    "description": "Цілі на 3–6 місяців\n\nОчікуваний результат: План розвитку",
    "owner_role": "HR + Керівник",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Прийняття рішення: Успішно / продовжити / неуспішно",
    "description": "Формальне рішення керівника та HR\n\nОчікуваний результат: Закриття адаптації",
    "owner_role": "HR",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Підсумкове опитування «90 днів в Fresh Black»",
    "description": "Збір зворотного звʼязку для HR\n\nОчікуваний результат: Покращення процесу",
    "owner_role": "HR",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Повний місячний SMM-звіт",
    "description": "Глибокий аналіз показників за 3 місяці\n\nОчікуваний результат: Рівень самостійності",
    "owner_role": "SMM",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Підготовка контент-проєкту",
    "description": "Серія постів/відео/колаборація\n\nОчікуваний результат: Креативність та системність",
    "owner_role": "SMM / TL",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Перші рекомендації по стратегії",
    "description": "Пропозиції щодо покращення\n\nОчікуваний результат: Готовність мислити стратегічно",
    "owner_role": "Marketing Lead",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Підготовка рекламного аналізу",
    "description": "ROI, CPA, CTR, сегменти\n\nОчікуваний результат: Розуміння реклами",
    "owner_role": "Digital Coordinator",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Company",
    "department": null,
    "milestone": "90 days",
    "title": "Командна інтеграція",
    "description": "Участь у мітингах, проєктах\n\nОчікуваний результат: Соціальна адаптація",
    "owner_role": "TL",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "90 days",
    "title": "Досягнення перших KPI продажів",
    "description": "N кількість угод / дохід\n\nОчікуваний результат: Фактичний результат",
    "owner_role": "Commercial Director",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "90 days",
    "title": "Побудова власної клієнтської бази",
    "description": "Холодні + теплі контакти\n\nОчікуваний результат: Системність",
    "owner_role": "B2B Lead",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "90 days",
    "title": "Повний аналіз CRM",
    "description": "Воронка, конверсія, затримки\n\nОчікуваний результат: Сильне володіння CRM",
    "owner_role": "Sales Ops",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "90 days",
    "title": "Самостійна презентація",
    "description": "Онлайн/офлайн\n\nОчікуваний результат: Комунікаційні навички",
    "owner_role": "Sales Ops / Керівник",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Комерційний контур",
    "milestone": "90 days",
    "title": "Зрозуміти фінансову сторону продажів",
    "description": "Маржа, собівартість\n\nОчікуваний результат: Фінансова грамотність",
    "owner_role": "Фінменеджер",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "90 days",
    "title": "Повне ведення своєї ділянки",
    "description": "Без контролю\n\nОчікуваний результат: Самостійність",
    "owner_role": "Фінменеджер",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "90 days",
    "title": "Участь у закритті місяця",
    "description": "Проведення всіх операцій\n\nОчікуваний результат: Технічна компетенція",
    "owner_role": "Фіндиректор",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "90 days",
    "title": "Підготовка повного P&L",
    "description": "Звірка, аналіз\n\nОчікуваний результат: Аналітична зрілість",
    "owner_role": "Економіст",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Фінансовий контур",
    "milestone": "90 days",
    "title": "Розуміння фінмоделі бізнесу",
    "description": "Витрати, прибутковість\n\nОчікуваний результат: Системне мислення",
    "owner_role": "Фіндиректор",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "90 days",
    "title": "Повноцінна робота на лінії",
    "description": "Без помилок\n\nОчікуваний результат: Кваліфікований сотрудник",
    "owner_role": "Production Lead",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "90 days",
    "title": "Оцінка швидкості роботи",
    "description": "Норма часу, обсяги\n\nОчікуваний результат: Продуктивність",
    "owner_role": "Старший фасувальник",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Виробництво",
    "milestone": "90 days",
    "title": "Контроль якості на рівні середнього/високого",
    "description": "HACCP, пакування\n\nОчікуваний результат: Стабільність",
    "owner_role": "Production Lead",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "90 days",
    "title": "Фінальна оцінка 90 днів",
    "description": "HR, керівник, новачок\n\nОчікуваний результат: Успішність / неуспішність",
    "owner_role": "HRD",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "90 days",
    "title": "Формування плану розвитку",
    "description": "На 3–6 місяців\n\nОчікуваний результат: Чітка траєкторія розвитку",
    "owner_role": "HRD",
    "due_offset_days": 90,
    "required": true
  },
  {
    "scope": "Department",
    "department": "Контур управління персоналом",
    "milestone": "90 days",
    "title": "Завершення адаптації",
    "description": "Документи, рішення\n\nОчікуваний результат: Закритий процес",
    "owner_role": "HRD",
    "due_offset_days": 90,
    "required": true
  }
];
