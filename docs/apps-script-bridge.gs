const SHEET_ID = '1FwF0tUmHE2XVLM8CB_qcp_1YtcZNbr0IqFDJd0BCJ8Q';
const CHECKINS_SHEET = 'checkins';
const TIMEOFF_SHEET = 'timeoff_requests';
const PRODUCTION_SHEET = 'production_shift_log';
const EMPLOYEES_SHEET = 'employees';
const TZ = 'Europe/Kyiv';

function doGet() {
  return ContentService
    .createTextOutput('FreshBlack Railway Bridge OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const data = JSON.parse(raw);

    if (!data.action) {
      return jsonResponse_({ ok: false, error: 'Missing action' });
    }

    switch (data.action) {
      case 'get_employee':
        return jsonResponse_({ ok: true, result: getEmployeeById_(data.employee_id || '') });

      case 'upsert_employee_chat':
        return jsonResponse_({
          ok: true,
          result: upsertEmployeeChat_(
            data.employee_id || '',
            data.telegram_chat_id || '',
            data.telegram_user_id || ''
          )
        });

      case 'list_employees_for_opening_reminder':
        return jsonResponse_({ ok: true, result: listEmployeesForOpeningReminder_() });

      case 'get_daily_checkin_status':
        return jsonResponse_({
          ok: true,
          result: getDailyCheckinStatus_(
            data.employee_id || '',
            data.telegram_chat_id || '',
            data.telegram_user_id || '',
            data.full_name || ''
          )
        });

      case 'has_today_in':
        return jsonResponse_({
          ok: true,
          result: hasTodayType_(
            'in',
            data.employee_id || '',
            data.telegram_chat_id || '',
            data.telegram_user_id || '',
            data.full_name || ''
          )
        });

      case 'has_today_out':
        return jsonResponse_({
          ok: true,
          result: hasTodayType_(
            'out',
            data.employee_id || '',
            data.telegram_chat_id || '',
            data.telegram_user_id || '',
            data.full_name || ''
          )
        });

      case 'list_open_shifts_for_closing_reminder':
        return jsonResponse_({
          ok: true,
          result: listOpenShiftsForClosingReminder_(data.entry_type || '')
        });

      case 'is_employee_absent_on_date':
        return jsonResponse_({
          ok: true,
          result: isEmployeeAbsentOnDate_(
            data.employee_id || '',
            data.date || '',
            data.telegram_chat_id || '',
            data.telegram_user_id || '',
            data.full_name || ''
          )
        });

      case 'checkin':
        return jsonResponse_({ ok: true, result: saveCheckin_(data) });

      case 'timeoff_request':
        return jsonResponse_({ ok: true, result: saveTimeoffRequest_(data) });

      case 'get_timeoff_request':
        return jsonResponse_({ ok: true, result: getTimeoffRequestById_(data.request_id || '') });

      case 'update_timeoff_status':
        return jsonResponse_({ ok: true, result: updateTimeoffStatus_(data) });

      case 'production_shift':
        return jsonResponse_({ ok: true, result: saveProductionShift_(data) });

      // ---- Нижче: нові дії, додані для швидкості. Кожна замінює комбінацію
      // з кількох попередніх запитів ОДНИМ запитом, повертаючи той самий
      // результат, що й раніше, просто обчислений за одне звернення до
      // таблиці замість кількох. Стару поведінку жодна з них не змінює.

      case 'get_employee_day_context':
        return jsonResponse_({
          ok: true,
          result: getEmployeeDayContext_(
            data.employee_id || '',
            data.telegram_chat_id || '',
            data.telegram_user_id || '',
            data.full_name || ''
          )
        });

      case 'list_opening_reminder_targets':
        return jsonResponse_({ ok: true, result: listOpeningReminderTargets_() });

      case 'list_closing_reminder_targets':
        return jsonResponse_({
          ok: true,
          result: listClosingReminderTargets_(data.entry_type || '')
        });

      default:
        return jsonResponse_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function getEmployeeById_(employeeIdRaw) {
  const employeeId = String(employeeIdRaw || '').trim();
  if (!employeeId) return { found: false, error: 'Missing employee_id' };

  const sh = getOrCreateSheet_(EMPLOYEES_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  if (lastRow < 2 || lastCol < 1) {
    return { found: false, error: 'Employees sheet is empty' };
  }

  const headers = getHeaders_(sh);
  const idxEmployeeId = headers.indexOf('employee_id');
  const idxFullName = headers.indexOf('full_name');
  const idxChatId = headers.indexOf('telegram_chat_id');
  const idxUserId = headers.indexOf('telegram_user_id');

  if (idxEmployeeId === -1 || idxFullName === -1) {
    return { found: false, error: 'employees sheet must contain employee_id and full_name' };
  }

  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  for (var i = 0; i < rows.length; i++) {
    const rowEmployeeId = String(rows[i][idxEmployeeId] || '').trim();
    if (rowEmployeeId === employeeId) {
      return {
        found: true,
        employee_id: rowEmployeeId,
        full_name: String(rows[i][idxFullName] || '').trim(),
        telegram_chat_id: idxChatId !== -1 ? String(rows[i][idxChatId] || '').trim() : '',
        telegram_user_id: idxUserId !== -1 ? String(rows[i][idxUserId] || '').trim() : ''
      };
    }
  }

  return { found: false, error: 'Employee not found' };
}

function upsertEmployeeChat_(employeeIdRaw, chatIdRaw, userIdRaw) {
  const employeeId = String(employeeIdRaw || '').trim();
  const chatId = String(chatIdRaw || '').trim();
  const userId = String(userIdRaw || '').trim();

  if (!employeeId) {
    return { updated: false, error: 'Missing employee_id' };
  }

  const sh = getOrCreateSheet_(EMPLOYEES_SHEET);
  const headers = ensureHeaders_(sh, ['employee_id', 'full_name', 'telegram_chat_id', 'telegram_user_id']);
  const idxEmployeeId = headers.indexOf('employee_id');
  const idxChatId = headers.indexOf('telegram_chat_id');
  const idxUserId = headers.indexOf('telegram_user_id');

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { updated: false, error: 'employees sheet is empty' };
  }

  const rows = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();

  for (var i = 0; i < rows.length; i++) {
    const rowEmployeeId = String(rows[i][idxEmployeeId] || '').trim();
    if (rowEmployeeId === employeeId) {
      if (idxChatId !== -1 && chatId) sh.getRange(i + 2, idxChatId + 1).setValue(chatId);
      if (idxUserId !== -1 && userId) sh.getRange(i + 2, idxUserId + 1).setValue(userId);

      return {
        updated: true,
        employee_id: employeeId,
        telegram_chat_id: chatId,
        telegram_user_id: userId
      };
    }
  }

  return { updated: false, error: 'Employee not found' };
}

function listEmployeesForOpeningReminder_() {
  const sh = getOrCreateSheet_(EMPLOYEES_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { employees: [] };

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const result = [];
  rows.forEach(function(row) {
    const employeeId = String(getCellByHeader_(row, headers, 'employee_id') || '').trim();
    const fullName = String(getCellByHeader_(row, headers, 'full_name') || '').trim();
    const chatId = String(getCellByHeader_(row, headers, 'telegram_chat_id') || '').trim();
    const userId = String(getCellByHeader_(row, headers, 'telegram_user_id') || '').trim();
    const activeRaw = String(getCellByHeader_(row, headers, 'active') || '').trim().toLowerCase();

    if (!employeeId || !chatId) return;
    if (['false', '0', 'no', 'inactive', 'ні'].includes(activeRaw)) return;

    result.push({
      employee_id: employeeId,
      full_name: fullName,
      telegram_chat_id: chatId,
      telegram_user_id: userId
    });
  });

  return { employees: result };
}

function getDailyCheckinStatus_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw) {
  return {
    has_any: hasTodayType_('', employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw).found_any,
    has_in: hasTodayType_('in', employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw).exists,
    has_out: hasTodayType_('out', employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw).exists,
    last_entry_type: getLastTodayField_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw, 'entry_type'),
    last_work_format: getLastTodayField_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw, 'work_format')
  };
}

function hasTodayType_(wantedType, employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw) {
  const identity = resolveIdentity_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw);

  const sh = getOrCreateSheet_(CHECKINS_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  if (lastRow < 2 || lastCol < 1) {
    return { exists: false, found_any: false };
  }

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  let exists = false;
  let foundAny = false;

  rows.forEach(function(row) {
    const rowEmployeeId = String(getCellByHeader_(row, headers, 'employee_id') || '').trim();
    const rowChatId = String(getCellByHeader_(row, headers, 'telegram_chat_id') || '').trim();
    const rowUserId = String(getCellByHeader_(row, headers, 'telegram_user_id') || '').trim();
    const rowFullName = String(getCellByHeader_(row, headers, 'full_name') || '').trim().toLowerCase();
    const rowDate = normalizeDateOnly_(getCellByHeader_(row, headers, 'timestamp'));
    const rowType = String(getCellByHeader_(row, headers, 'type') || '').trim().toLowerCase();

    const matchByEmployee = identity.employee_id && rowEmployeeId === identity.employee_id;
    const matchByChat = identity.telegram_chat_id && rowChatId === identity.telegram_chat_id;
    const matchByUser = identity.telegram_user_id && rowUserId === identity.telegram_user_id;
    const matchByName = identity.full_name && rowFullName === identity.full_name;

    if (!matchByEmployee && !matchByChat && !matchByUser && !matchByName) return;
    if (rowDate !== today) return;

    foundAny = true;

    if (!wantedType) {
      exists = true;
      return;
    }

    if (rowType === wantedType.toLowerCase()) {
      exists = true;
    }
  });

  return { exists: exists, found_any: foundAny };
}

function getLastTodayField_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw, fieldName) {
  const identity = resolveIdentity_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw);

  const sh = getOrCreateSheet_(CHECKINS_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return '';

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  let val = '';

  rows.forEach(function(row) {
    const rowEmployeeId = String(getCellByHeader_(row, headers, 'employee_id') || '').trim();
    const rowChatId = String(getCellByHeader_(row, headers, 'telegram_chat_id') || '').trim();
    const rowUserId = String(getCellByHeader_(row, headers, 'telegram_user_id') || '').trim();
    const rowFullName = String(getCellByHeader_(row, headers, 'full_name') || '').trim().toLowerCase();
    const rowDate = normalizeDateOnly_(getCellByHeader_(row, headers, 'timestamp'));

    const matchByEmployee = identity.employee_id && rowEmployeeId === identity.employee_id;
    const matchByChat = identity.telegram_chat_id && rowChatId === identity.telegram_chat_id;
    const matchByUser = identity.telegram_user_id && rowUserId === identity.telegram_user_id;
    const matchByName = identity.full_name && rowFullName === identity.full_name;

    if (!matchByEmployee && !matchByChat && !matchByUser && !matchByName) return;
    if (rowDate !== today) return;

    val = String(getCellByHeader_(row, headers, fieldName) || '').trim();
  });

  return val;
}

function listOpenShiftsForClosingReminder_(entryTypeRaw) {
  const entryType = String(entryTypeRaw || '').trim();

  const sh = getOrCreateSheet_(CHECKINS_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { employees: [] };

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const map = {};

  rows.forEach(function(row) {
    const employeeId = String(getCellByHeader_(row, headers, 'employee_id') || '').trim();
    const chatId = String(getCellByHeader_(row, headers, 'telegram_chat_id') || '').trim();
    const userId = String(getCellByHeader_(row, headers, 'telegram_user_id') || '').trim();
    const fullName = String(getCellByHeader_(row, headers, 'full_name') || '').trim();
    const rowDate = normalizeDateOnly_(getCellByHeader_(row, headers, 'timestamp'));
    const type = String(getCellByHeader_(row, headers, 'type') || '').trim().toLowerCase();
    const rowEntryType = String(getCellByHeader_(row, headers, 'entry_type') || '').trim();

    if (!employeeId || !chatId || rowDate !== today) return;
    if (entryType && rowEntryType !== entryType) return;

    if (!map[employeeId]) {
      map[employeeId] = {
        employee_id: employeeId,
        telegram_chat_id: chatId,
        telegram_user_id: userId,
        full_name: fullName,
        entry_type: rowEntryType,
        has_in: false,
        has_out: false
      };
    }

    if (type === 'in') map[employeeId].has_in = true;
    if (type === 'out') map[employeeId].has_out = true;
  });

  const result = [];
  Object.keys(map).forEach(function(key) {
    if (map[key].has_in && !map[key].has_out) result.push(map[key]);
  });

  return { employees: result };
}

function isEmployeeAbsentOnDate_(employeeIdRaw, dateRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw) {
  const identity = resolveIdentity_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw);
  const date = String(dateRaw || '').trim();

  if (!date) return { absent: false };

  const sh = getOrCreateSheet_(TIMEOFF_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { absent: false };

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  let absent = false;
  let reason = '';

  rows.forEach(function(row) {
    const rowEmployeeId = String(getCellByHeader_(row, headers, 'employee_id') || '').trim();
    const rowChatId = String(getCellByHeader_(row, headers, 'telegram_chat_id') || '').trim();
    const rowUserId = String(getCellByHeader_(row, headers, 'telegram_user_id') || '').trim();
    const rowFullName = String(getCellByHeader_(row, headers, 'full_name') || '').trim().toLowerCase();

    const dateFrom = String(getCellByHeader_(row, headers, 'date_from') || '').trim();
    const dateTo = String(getCellByHeader_(row, headers, 'date_to') || '').trim();
    const requestType = String(getCellByHeader_(row, headers, 'request_type') || '').trim();
    const status = String(getCellByHeader_(row, headers, 'status') || '').trim().toLowerCase();
    const finalStatus = String(getCellByHeader_(row, headers, 'final_status') || '').trim().toLowerCase();

    const matchByEmployee = identity.employee_id && rowEmployeeId === identity.employee_id;
    const matchByChat = identity.telegram_chat_id && rowChatId === identity.telegram_chat_id;
    const matchByUser = identity.telegram_user_id && rowUserId === identity.telegram_user_id;
    const matchByName = identity.full_name && rowFullName === identity.full_name;

    if (!matchByEmployee && !matchByChat && !matchByUser && !matchByName) return;
    if (!dateFrom || !dateTo) return;
    if (status === 'rejected' || finalStatus === 'rejected') return;

    const fromIso = ukrDateToIso_(dateFrom);
    const toIso = ukrDateToIso_(dateTo);

    if (!fromIso || !toIso) return;

    if (date >= fromIso && date <= toIso) {
      absent = true;
      reason = requestType || '';
    }
  });

  return { absent: absent, reason: reason };
}

function saveCheckin_(data) {
  const sh = getOrCreateSheet_(CHECKINS_SHEET);

  const headers = ensureHeaders_(sh, [
    'timestamp',
    'employee_id',
    'telegram_user_id',
    'name',
    'type (in/out)',
    'note',
    'lat',
    'lon',
    'mode',
    'full_name',
    'type',
    'telegram_chat_id',
    'source',
    'entry_type',
    'work_format',
    'remote_reason'
  ]);

  const identity = resolveIdentity_(
    data.employee_id || '',
    data.telegram_chat_id || '',
    data.telegram_user_id || '',
    data.full_name || ''
  );

  const row = new Array(headers.length).fill('');
  const fullName = identity.full_name_original || String(data.full_name || '').trim();

  setIfExists_(row, headers, 'timestamp', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'));
  setIfExists_(row, headers, 'employee_id', identity.employee_id || data.employee_id || '');
  setIfExists_(row, headers, 'telegram_user_id', identity.telegram_user_id || data.telegram_user_id || '');
  setIfExists_(row, headers, 'name', fullName);
  setIfExists_(row, headers, 'type (in/out)', data.type || '');
  setIfExists_(row, headers, 'note', data.note || '');
  setIfExists_(row, headers, 'lat', data.lat || '');
  setIfExists_(row, headers, 'lon', data.lon || '');
  setIfExists_(row, headers, 'mode', data.mode || '');
  setIfExists_(row, headers, 'full_name', fullName);
  setIfExists_(row, headers, 'type', data.type || '');
  setIfExists_(row, headers, 'telegram_chat_id', identity.telegram_chat_id || data.telegram_chat_id || '');
  setIfExists_(row, headers, 'source', 'railway');
  setIfExists_(row, headers, 'entry_type', data.entry_type || '');
  setIfExists_(row, headers, 'work_format', data.work_format || '');
  setIfExists_(row, headers, 'remote_reason', data.remote_reason || '');

  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return { saved: true };
}

function saveTimeoffRequest_(data) {
  const sh = getOrCreateSheet_(TIMEOFF_SHEET);

  const headers = ensureHeaders_(sh, [
    'request_id',
    'created_at',
    'employee_id',
    'telegram_chat_id',
    'telegram_user_id',
    'full_name',
    'request_type',
    'request_subtype',
    'date_from',
    'date_to',
    'replacement_person',
    'replacement_contact',
    'comment',
    'status',
    'approved_by_hrd',
    'approved_at_hrd',
    'approved_by_accountant',
    'approved_at_accountant',
    'notified_finance',
    'finance_note',
    'source',
    'status_hr',
    'status_chief_acc',
    'final_status',
    'hr_message_id',
    'accountant_message_id'
  ]);

  const identity = resolveIdentity_(
    data.employee_id || '',
    data.telegram_chat_id || '',
    data.telegram_user_id || '',
    data.full_name || ''
  );

  const requestId =
    'REQ-' +
    Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') +
    '-' +
    Math.floor(Math.random() * 1000);

  const row = new Array(headers.length).fill('');
  const fullName = identity.full_name_original || String(data.full_name || '').trim();

  setIfExists_(row, headers, 'request_id', requestId);
  setIfExists_(row, headers, 'created_at', Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy HH:mm:ss'));
  setIfExists_(row, headers, 'employee_id', identity.employee_id || data.employee_id || '');
  setIfExists_(row, headers, 'telegram_chat_id', identity.telegram_chat_id || data.telegram_chat_id || '');
  setIfExists_(row, headers, 'telegram_user_id', identity.telegram_user_id || data.telegram_user_id || '');
  setIfExists_(row, headers, 'full_name', fullName);
  setIfExists_(row, headers, 'request_type', data.request_type || '');
  setIfExists_(row, headers, 'request_subtype', data.request_subtype || '');
  setIfExists_(row, headers, 'date_from', data.date_from || '');
  setIfExists_(row, headers, 'date_to', data.date_to || '');
  setIfExists_(row, headers, 'replacement_person', data.replacement_person || '');
  setIfExists_(row, headers, 'replacement_contact', data.replacement_contact || '');
  setIfExists_(row, headers, 'comment', data.comment || '');
  setIfExists_(row, headers, 'status', 'pending_hrd');
  setIfExists_(row, headers, 'approved_by_hrd', '');
  setIfExists_(row, headers, 'approved_at_hrd', '');
  setIfExists_(row, headers, 'approved_by_accountant', '');
  setIfExists_(row, headers, 'approved_at_accountant', '');
  setIfExists_(row, headers, 'notified_finance', 'no');
  setIfExists_(row, headers, 'finance_note', '');
  setIfExists_(row, headers, 'source', 'railway');
  setIfExists_(row, headers, 'status_hr', 'pending_hrd');
  setIfExists_(row, headers, 'status_chief_acc', '');
  setIfExists_(row, headers, 'final_status', 'pending_hrd');
  setIfExists_(row, headers, 'hr_message_id', '');
  setIfExists_(row, headers, 'accountant_message_id', '');

  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);

  return { saved: true, request_id: requestId };
}

function getTimeoffRequestById_(requestIdRaw) {
  const requestId = String(requestIdRaw || '').trim();
  if (!requestId) return { found: false, error: 'Missing request_id' };

  const sh = getOrCreateSheet_(TIMEOFF_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { found: false, error: 'No requests' };

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  for (var i = 0; i < rows.length; i++) {
    const rowRequestId = String(getCellByHeader_(rows[i], headers, 'request_id') || '').trim();
    if (rowRequestId === requestId) {
      const obj = rowToObject_(rows[i], headers);
      obj.found = true;
      obj.row_number = i + 2;
      return obj;
    }
  }

  return { found: false, error: 'Request not found' };
}

function updateTimeoffStatus_(data) {
  const requestId = String(data.request_id || '').trim();
  if (!requestId) throw new Error('Missing request_id');

  const sh = getOrCreateSheet_(TIMEOFF_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) throw new Error('No requests');

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  let targetRow = -1;
  for (var i = 0; i < rows.length; i++) {
    const rowRequestId = String(getCellByHeader_(rows[i], headers, 'request_id') || '').trim();
    if (rowRequestId === requestId) {
      targetRow = i + 2;
      break;
    }
  }

  if (targetRow === -1) throw new Error('Request not found');

  const editableKeys = [
    'status',
    'approved_by_hrd',
    'approved_at_hrd',
    'approved_by_accountant',
    'approved_at_accountant',
    'notified_finance',
    'finance_note',
    'status_hr',
    'status_chief_acc',
    'final_status',
    'hr_message_id',
    'accountant_message_id'
  ];

  editableKeys.forEach(function(key) {
    if (typeof data[key] !== 'undefined') {
      const idx = headers.indexOf(key);
      if (idx !== -1) {
        sh.getRange(targetRow, idx + 1).setValue(data[key]);
      }
    }
  });

  return { updated: true, request_id: requestId };
}

function saveProductionShift_(data) {
  const sh = getOrCreateSheet_(PRODUCTION_SHEET);

  const headers = ensureHeaders_(sh, [
    'shift_id',
    'opened_at',
    'closed_at',
    'employee_id',
    'telegram_chat_id',
    'telegram_user_id',
    'full_name',
    'station_name',
    'result_text',
    'source'
  ]);

  const identity = resolveIdentity_(
    data.employee_id || '',
    data.telegram_chat_id || '',
    data.telegram_user_id || '',
    data.full_name || ''
  );

  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) throw new Error('No production entries provided');

  const rows = entries.map(function(entry) {
    const row = new Array(headers.length).fill('');
    setIfExists_(row, headers, 'shift_id', data.shift_id || '');
    setIfExists_(row, headers, 'opened_at', data.opened_at || '');
    setIfExists_(row, headers, 'closed_at', data.closed_at || '');
    setIfExists_(row, headers, 'employee_id', identity.employee_id || data.employee_id || '');
    setIfExists_(row, headers, 'telegram_chat_id', identity.telegram_chat_id || data.telegram_chat_id || '');
    setIfExists_(row, headers, 'telegram_user_id', identity.telegram_user_id || data.telegram_user_id || '');
    setIfExists_(row, headers, 'full_name', identity.full_name_original || data.full_name || '');
    setIfExists_(row, headers, 'station_name', entry.station_name || '');
    setIfExists_(row, headers, 'result_text', entry.result_text || '');
    setIfExists_(row, headers, 'source', 'railway');
    return row;
  });

  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  return {
    saved: true,
    shift_id: data.shift_id || '',
    rows_saved: rows.length
  };
}

// ---- Нижче: нові допоміжні й "об'єднані" функції для швидкості ----

// Те саме, що is_employee_absent_on_date (дата = сьогодні) +
// get_daily_checkin_status, але одним запитом. Використовується там, де бот
// раніше робив два послідовні звернення до bridge підряд.
function getEmployeeDayContext_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw) {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  const dailyStatus = getDailyCheckinStatus_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw);
  const absence = isEmployeeAbsentOnDate_(employeeIdRaw, today, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw);

  return {
    has_any: dailyStatus.has_any,
    has_in: dailyStatus.has_in,
    has_out: dailyStatus.has_out,
    last_entry_type: dailyStatus.last_entry_type,
    last_work_format: dailyStatus.last_work_format,
    absent: absence.absent,
    absent_reason: absence.reason
  };
}

// Один прохід по checkins за сьогодні -> employee_id -> {has_in, has_out, entry_type}
function buildTodayCheckinIndex_(todayStr) {
  const sh = getOrCreateSheet_(CHECKINS_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const index = {};
  if (lastRow < 2 || lastCol < 1) return index;

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  rows.forEach(function(row) {
    const employeeId = String(getCellByHeader_(row, headers, 'employee_id') || '').trim();
    const rowDate = normalizeDateOnly_(getCellByHeader_(row, headers, 'timestamp'));
    if (!employeeId || rowDate !== todayStr) return;

    const type = String(getCellByHeader_(row, headers, 'type') || '').trim().toLowerCase();
    const entryType = String(getCellByHeader_(row, headers, 'entry_type') || '').trim();

    if (!index[employeeId]) {
      index[employeeId] = { has_in: false, has_out: false, entry_type: entryType };
    }
    if (type === 'in') {
      index[employeeId].has_in = true;
      index[employeeId].entry_type = entryType;
    }
    if (type === 'out') index[employeeId].has_out = true;
  });

  return index;
}

// Один прохід по timeoff_requests -> Set(employee_id), відсутні на дату todayStr
// (та сама умова, що й у isEmployeeAbsentOnDate_: будь-який статус, окрім rejected)
function buildTodayAbsenceIndex_(todayStr) {
  const sh = getOrCreateSheet_(TIMEOFF_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const index = {};
  if (lastRow < 2 || lastCol < 1) return index;

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  rows.forEach(function(row) {
    const employeeId = String(getCellByHeader_(row, headers, 'employee_id') || '').trim();
    if (!employeeId) return;

    const dateFrom = String(getCellByHeader_(row, headers, 'date_from') || '').trim();
    const dateTo = String(getCellByHeader_(row, headers, 'date_to') || '').trim();
    const status = String(getCellByHeader_(row, headers, 'status') || '').trim().toLowerCase();
    const finalStatus = String(getCellByHeader_(row, headers, 'final_status') || '').trim().toLowerCase();

    if (!dateFrom || !dateTo) return;
    if (status === 'rejected' || finalStatus === 'rejected') return;

    const fromIso = ukrDateToIso_(dateFrom);
    const toIso = ukrDateToIso_(dateTo);
    if (!fromIso || !toIso) return;

    if (todayStr >= fromIso && todayStr <= toIso) {
      index[employeeId] = true;
    }
  });

  return index;
}

// Замінює цикл "для кожного співробітника: is_employee_absent_on_date +
// get_daily_checkin_status" одним обчисленням: employees читається раз,
// checkins читається раз, timeoff_requests читається раз — незалежно від
// того, скільки в компанії співробітників.
function listOpeningReminderTargets_() {
  const employees = listEmployeesForOpeningReminder_().employees;
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const checkinIndex = buildTodayCheckinIndex_(today);
  const absenceIndex = buildTodayAbsenceIndex_(today);

  const result = employees.filter(function(emp) {
    if (absenceIndex[emp.employee_id]) return false;
    const status = checkinIndex[emp.employee_id];
    return !(status && status.has_in);
  });

  return { employees: result };
}

// Те саме, що list_open_shifts_for_closing_reminder + is_employee_absent_on_date
// для кожного знайденого співробітника, але одним проходом.
function listClosingReminderTargets_(entryTypeRaw) {
  const entryType = String(entryTypeRaw || '').trim();

  const sh = getOrCreateSheet_(CHECKINS_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { employees: [] };

  const headers = getHeaders_(sh);
  const rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const map = {};

  rows.forEach(function(row) {
    const employeeId = String(getCellByHeader_(row, headers, 'employee_id') || '').trim();
    const chatId = String(getCellByHeader_(row, headers, 'telegram_chat_id') || '').trim();
    const userId = String(getCellByHeader_(row, headers, 'telegram_user_id') || '').trim();
    const fullName = String(getCellByHeader_(row, headers, 'full_name') || '').trim();
    const rowDate = normalizeDateOnly_(getCellByHeader_(row, headers, 'timestamp'));
    const type = String(getCellByHeader_(row, headers, 'type') || '').trim().toLowerCase();
    const rowEntryType = String(getCellByHeader_(row, headers, 'entry_type') || '').trim();

    if (!employeeId || !chatId || rowDate !== today) return;
    if (entryType && rowEntryType !== entryType) return;

    if (!map[employeeId]) {
      map[employeeId] = {
        employee_id: employeeId,
        telegram_chat_id: chatId,
        telegram_user_id: userId,
        full_name: fullName,
        entry_type: rowEntryType,
        has_in: false,
        has_out: false
      };
    }

    if (type === 'in') map[employeeId].has_in = true;
    if (type === 'out') map[employeeId].has_out = true;
  });

  const absenceIndex = buildTodayAbsenceIndex_(today);

  const result = [];
  Object.keys(map).forEach(function(key) {
    if (!map[key].has_in || map[key].has_out) return;
    if (absenceIndex[key]) return;
    result.push(map[key]);
  });

  return { employees: result };
}

function resolveIdentity_(employeeIdRaw, telegramChatIdRaw, telegramUserIdRaw, fullNameRaw) {
  const employeeId = String(employeeIdRaw || '').trim();
  const telegramChatId = String(telegramChatIdRaw || '').trim();
  const telegramUserId = String(telegramUserIdRaw || '').trim();
  const fullName = String(fullNameRaw || '').trim();

  const result = {
    employee_id: employeeId,
    telegram_chat_id: telegramChatId,
    telegram_user_id: telegramUserId,
    full_name: fullName.toLowerCase(),
    full_name_original: fullName
  };

  if (!employeeId) return result;

  const emp = getEmployeeById_(employeeId);
  if (emp && emp.found) {
    if (!result.telegram_chat_id) result.telegram_chat_id = String(emp.telegram_chat_id || '').trim();
    if (!result.telegram_user_id) result.telegram_user_id = String(emp.telegram_user_id || '').trim();
    if (!result.full_name_original) result.full_name_original = String(emp.full_name || '').trim();
    if (!result.full_name) result.full_name = String(emp.full_name || '').trim().toLowerCase();
  }

  return result;
}

function ukrDateToIso_(str) {
  const m = String(str || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return '';
  return m[3] + '-' + m[2] + '-' + m[1];
}

function normalizeDateOnly_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
  }

  const str = String(value).trim();

  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return '';
}

function getOrCreateSheet_(sheetName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  return sh;
}

function getHeaders_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h).trim();
  });
}

function ensureHeaders_(sh, requiredHeaders) {
  let headers = getHeaders_(sh);

  if (headers.length === 0) {
    sh.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return requiredHeaders;
  }

  requiredHeaders.forEach(function(h) {
    if (headers.indexOf(h) === -1) {
      headers.push(h);
      sh.getRange(1, headers.length).setValue(h);
    }
  });

  return headers;
}

function getCellByHeader_(row, headers, key) {
  const idx = headers.indexOf(key);
  return idx === -1 ? '' : row[idx];
}

function setIfExists_(row, headers, key, value) {
  const idx = headers.indexOf(key);
  if (idx !== -1) row[idx] = value;
}

function rowToObject_(row, headers) {
  const obj = {};
  for (var i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i];
  }
  return obj;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
