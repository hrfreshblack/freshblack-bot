// Початковий обліковий запис HRD. Пароль — НЕ у відкритому вигляді (тут
// лише bcrypt-хеш), Тетяна отримала реальний пароль окремо в чаті і має
// його змінити після першого входу. createAccountIfMissingWithHash ніколи
// не перезаписує пароль уже наявного акаунта.
export default [
  {
    "username": "tetiana",
    "role": "HRD",
    "display_name": "Тетяна Своволя",
    "password_hash": "$2b$10$4csz/YEZ6OMzsVP692hgtO1B5j6yA.YPSv.RJ6wHytQT9KU2usw0O"
  }
];
