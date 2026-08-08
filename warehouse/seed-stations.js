// Реальні норми й співробітники станцій, як описала Тетяна (серпень 2026).
// Канонічні назви станцій — без варіацій регістру, щоб уникнути дублів.
export const STATION_NAME_ALIASES = {
  'ручна': 'Ручна',
  'центршов': 'Центршов',
  'дріп станок': 'Дріп станок',
  'збірка дріпів': 'Збірка дріпів'
};

export const stationNotes = {
  'Обсмажка кави': 'На виході смаженої кави приблизно на 15% менше за вагою зеленої — потребує уточнення.',
  'Фотосепарація': 'В інші дні (крім Пн/Ср/Пт) норма не змінюється, просто ставиться інший співробітник.',
  'Замішування кави': 'Замішування різних видів блендів за потреби плану фасування, не обов’язково один вид за раз.',
  'Дріп станок': 'Норма занижена, буде збільшена пізніше.',
  'Збірка дріпів': 'Норми потребують перегляду — по факту часто працюють під конкретне замовлення, а не на склад, тому норма не завжди виконується.'
};

export const stationOperations = [
  { station: 'Обсмажка кави', operation_name: '', base_norm: 1140, target_norm: null, unit: 'кг зеленої кави/день' },
  { station: 'Фотосепарація', operation_name: '', base_norm: 950, target_norm: null, unit: 'кг/день' },
  { station: 'Замішування кави', operation_name: '', base_norm: 600, target_norm: null, unit: 'кг замішаної кави/день' },
  { station: 'Центршов', operation_name: '', base_norm: 600, target_norm: null, unit: 'кг/день (пачка 1кг м’яка)' },
  { station: 'Ручна', operation_name: '', base_norm: 300, target_norm: null, unit: 'пачок/день (вага не має значення)' },
  { station: 'Дріп станок', operation_name: '', base_norm: 2300, target_norm: null, unit: 'шт/день' },
  { station: 'Збірка дріпів', operation_name: 'Шоубокси по 25 дріпів', base_norm: 200, target_norm: null, unit: 'коробок/день' },
  { station: 'Збірка дріпів', operation_name: 'Коробка 5/7 дріпів', base_norm: 300, target_norm: null, unit: 'коробок/день' },
  { station: 'Збірка дріпів', operation_name: 'Наліпка на дріп (без брендованої плівки)', base_norm: 1000, target_norm: null, unit: 'наліпок/день' },
  { station: 'Збірка дріпів', operation_name: 'ХлібПром (прозорий пакет)', base_norm: 20, target_norm: null, unit: 'ящиків/день по 200 дріпів' }
];

export const stationEmployees = [
  { station: 'Обсмажка кави', employee_name: 'Нападій Владислав', personal_norm: 342, personal_norm_unit: 'кг', schedule_note: '' },
  { station: 'Обсмажка кави', employee_name: 'Лобурєв Дмитро', personal_norm: 798, personal_norm_unit: 'кг', schedule_note: '' },
  { station: 'Фотосепарація', employee_name: 'Капінус Дмитро', personal_norm: null, personal_norm_unit: '', schedule_note: 'Пн, Ср, Пт' },
  { station: 'Замішування кави', employee_name: 'Капінус Дмитро', personal_norm: null, personal_norm_unit: '', schedule_note: 'Пн, Ср, Пт' },
  { station: 'Центршов', employee_name: 'Климчук Ірина', personal_norm: null, personal_norm_unit: '', schedule_note: '' },
  { station: 'Ручна', employee_name: 'Яковлєв Андрій', personal_norm: null, personal_norm_unit: '', schedule_note: '' },
  { station: 'Ручна', employee_name: 'Коваль Тетяна', personal_norm: null, personal_norm_unit: '', schedule_note: '' },
  { station: 'Дріп станок', employee_name: 'Коваль Катерина', personal_norm: null, personal_norm_unit: '', schedule_note: '' },
  { station: 'Збірка дріпів', employee_name: 'Коваленко Сергій', personal_norm: null, personal_norm_unit: '', schedule_note: 'ХлібПром' }
];
