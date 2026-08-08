// Початкові облікові записи. Паролі — НЕ у відкритому вигляді (тут лише
// bcrypt-хеші) — Тетяна отримала реальні паролі окремо в чаті і має їх
// зберегти/змінити. createAccountIfMissingWithHash ніколи не перезаписує
// пароль уже наявного акаунта.
export default [
  {
    "username": "tetiana",
    "role": "адмін",
    "home_station": null,
    "display_name": "Тетяна Своволя",
    "password_hash": "$2b$10$opagC/4sO0Rp7l.J2fr1BexlpMzGdVxS60.yg6MrjkuwUwACnTOUG"
  },
  {
    "username": "kovalk",
    "role": "тімлід",
    "home_station": null,
    "display_name": "Коваль Катерина",
    "password_hash": "$2b$10$k4PsxPK7upW2pJLzxshU.uulrCehGkWp4e6y3nN5nyr3qgN3gCaeG"
  },
  {
    "username": "obsmazhka",
    "role": "станція",
    "home_station": "Обсмажка кави",
    "display_name": "Обсмажка кави",
    "password_hash": "$2b$10$vUd0vlRV1l8RHum.CXwBXeNEEj2Kt.xasVj/p90sVTbcHOiMBHQDm"
  },
  {
    "username": "fotosep",
    "role": "станція",
    "home_station": "Фотосепарація",
    "display_name": "Фотосепарація",
    "password_hash": "$2b$10$CJwaBsODiNZJHq13kwe4cO9XbduQKzqetw7s3SDxfW9DECDY0KJKO"
  },
  {
    "username": "zamishuvannya",
    "role": "станція",
    "home_station": "Замішування кави",
    "display_name": "Замішування кави",
    "password_hash": "$2b$10$PD3Plb8b0u5VARU5pLdjtecbiotxJH0.rJMOOtklQJg0WmzTrA7zG"
  },
  {
    "username": "centrshov",
    "role": "станція",
    "home_station": "Центршов",
    "display_name": "Центршов",
    "password_hash": "$2b$10$JOUYjmiLafwVta0hPv4mQuJV1ABKf3iGy4Mv7y.6k5J5SPmZSDQRK"
  },
  {
    "username": "ruchna",
    "role": "станція",
    "home_station": "Ручна",
    "display_name": "Ручна",
    "password_hash": "$2b$10$We87mFBPSyjDgY/Nr6RymejVae0zCbnif7KcPbOjrh3KT/UiG1oQC"
  },
  {
    "username": "dripstanok",
    "role": "станція",
    "home_station": "Дріп станок",
    "display_name": "Дріп станок",
    "password_hash": "$2b$10$ZgiUXkFNQs9XZz25o6D.r.PKvp3qCzWug8bnFTa8/ljyG7S4E1ej6"
  },
  {
    "username": "zbirka",
    "role": "станція",
    "home_station": "Збірка дріпів",
    "display_name": "Збірка дріпів",
    "password_hash": "$2b$10$meK8U/FSeJMZRAAFzYfNyuwWzlZJ2aEFUNZObGEEPOrQHy9b/0fCS"
  }
];
