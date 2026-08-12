// Лоти зеленої кави, під якими фактично ховається кілька грейдів обсмажки
// (одна зеленка, але обсмажник смажить її по-різному під різну продукцію) —
// видно з napivfabrykat_names у seed-green-coffee.js, де перелічено більше
// однієї короткої назви через кому. Короткі назви в дужках стають
// grade_label: саме за ними ensureNapivfabrykatProducts() заводить окрему
// позицію напівфабрикату на кожен грейд замість однієї спільної "-NF" на
// весь лот. sap_code — поки порожній, заповнюється вручну в Зеленій каві.
export default [
  { green_coffee_code: 'PG-0049', grade_label: 'Cb2', sap_code: '' },
  { green_coffee_code: 'PG-0049', grade_label: 'CS5', sap_code: '' },
  { green_coffee_code: 'PG-0010', grade_label: 'Ed3', sap_code: '' },
  { green_coffee_code: 'PG-0010', grade_label: 'Ed5', sap_code: '' },
  { green_coffee_code: 'PG-0058', grade_label: 'P2', sap_code: '' },
  { green_coffee_code: 'PG-0058', grade_label: 'P4', sap_code: '' },
  { green_coffee_code: 'PG-0002', grade_label: 'Bd2', sap_code: '' },
  { green_coffee_code: 'PG-0002', grade_label: 'Bs3', sap_code: '' }
];
