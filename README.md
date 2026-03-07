# RegAD — Реестр и аудит Active Directory

**Pet-проект:** корпоративная система учёта кадров, доступов и изменений в Active Directory с ведением реестра приказов и аудитом действий.

---

## О проекте

**RegAD** — backend-приложение для ведения и аудита реестра сотрудников. Система предназначена для внутреннего использования в организации: учёт сотрудников, отделов, должностей, приказов (приём, перевод, увольнение, назначения, сброс паролей AD и т.д.), контрактов, обратной связи и синхронизации архивных данных из SQL Server в MongoDB в реальном времени.

Клиенты подключаются по **REST API** и **WebSocket**. Изменения в MongoDB транслируются всем подключённым клиентам через **Change Streams**, что даёт актуальные данные без постоянного опроса.

---

## Для чего нужен проект

- **Учёт кадров:** сотрудники, отделы, должности, приказы (приём, перевод, увольнение, назначение, стажировка, смена ФИО и т.д.).
- **Учёт доступов и прав:** запросы прав, сброс паролей AD, назначения, спецправа по отделам.
- **Договоры и контракты:** субъекты, компании, контракты, продления.
- **Обратная связь:** тикеты с возможностью прикрепления изображений.
- **Аудит:** кто и когда вносил изменения; логирование в файлы (Winston, ротация по дням).
- **Синхронизация с внешней БД:** периодическая выгрузка данных из SQL Server (таблица `ArchiveUserToChange`) в коллекцию MongoDB `ADTool` с настраиваемым интервалом (например, раз в 3 часа).

---

## Технологический стек

| Категория        | Технологии |
|------------------|------------|
| **Runtime**      | Node.js    |
| **Фреймворк**    | Express 4  |
| **Базы данных**  | MongoDB (Mongoose), MS SQL Server (mssql) |
| **Реальное время** | WebSocket (ws), MongoDB Change Streams |
| **Авторизация**  | JWT (jsonwebtoken), httpOnly cookies |
| **Безопасность** | CORS, cookie-parser, RBAC (admin / manager) |
| **Логирование**  | Winston, winston-daily-rotate-file |
| **Загрузка файлов** | Multer (обратная связь — изображения) |
| **Конфигурация** | dotenv |

---

## Как это работает

1. **Старт сервера** (`server.js`): проверка переменных окружения → подключение к MongoDB → запуск Change Stream на БД → поднятие HTTP-сервера и WebSocket на одном порту.
2. **REST API:** авторизация по `address` (логин), выдача JWT в httpOnly cookie; маршруты для доступа, обратной связи, работы с SQL (получение таблиц, запуск/остановка периодической синхронизации, ручная выгрузка).
3. **WebSocket:** клиент подключается с cookie `token`. Сервер проверяет JWT, извлекает роль и по типу сообщения (`getCollectionMongoose`, `insertInToCollection`, `updateInCollection`, `deleteFromCollection`, `getAllClientsIp` и т.д.) вызывает соответствующий обработчик. Доступ к действиям ограничен по ролям (RBAC).
4. **Change Stream:** при любом изменении в коллекциях MongoDB (кроме `ADTool`) сервер рассылает событие всем подключённым WebSocket-клиентам — интерфейс может обновлять данные без перезапроса.
5. **MongoDB + SQL:** основная бизнес-логика и документы хранятся в MongoDB (Mongoose-модели в `mongoose.js`, CRUD в `dbService.js`). SQL Server используется как источник архивных данных; периодическая задача читает таблицу и перезаписывает коллекцию `ADTool` в MongoDB.

---

## Запуск проекта

### Требования

- Node.js (рекомендуется LTS)
- MongoDB (запущен локально или доступен по `MONGO_URL`)
- MS SQL Server (если нужна синхронизация с SQL; для базового REST/WS можно заглушить переменные)

### Установка

```bash
git clone <url-репозитория>
cd Orojects
npm install
```

### Переменные окружения

Создайте в корне проекта файл `.env` (в репозитории его нет — см. `.gitignore`). Пример:

```env
# Обязательные
JWT_SECRET_KEY='ваш_секретный_ключ_для_подписи_JWT'
PORT=3000

# MongoDB
MONGO_URL='mongodb://localhost:27017'
MONGO_DB_CONNECTION_URL='mongodb://localhost:27017/RegAD'

# CORS — разрешённые источники для запросов (через запятую)
CORS_DOMAINS='http://localhost:5173,http://localhost:8080'

# SQL Server (для синхронизации архива в MongoDB)
SQL_USER='regeditad'
SQL_PASSWORD='ваш_пароль'
SQL_SERVER='localhost'
SQL_DATA_BASE='ADToolDB'
```

- **JWT_SECRET_KEY** — секрет для подписи токенов; на проде использовать длинный случайный ключ.
- **CORS_DOMAINS** — домены/порты фронтенда (например, Vite на 5173 или Nginx на 8080).
- **SQL_*** — только если используете выгрузку из SQL в коллекцию `ADTool`.

### Запуск

```bash
node server.js
```

Сервер слушает `http://localhost:PORT` (по умолчанию 3000). Логи пишутся в папку `logs/` (ротация по дням, сжатие, хранение 14 дней).

---

## Структура проекта (основное)

```
├── server.js           # Точка входа: Express, WebSocket, Change Stream, проверка JWT по WS
├── mongoose.js         # Подключение к MongoDB и все Mongoose-схемы (Users, Sotrudnik, Otdel, Pdoka, Contract, Feedback, ADTool и др.)
├── dbService.js        # CRUD для коллекций: getCollectionMongoose, insertInToCollection, updateInCollection, deleteFromCollection, обновление ссылок при удалении (Otdel/Doljnost)
├── connectSql.js       # Подключение к SQL Server, выгрузка ArchiveUserToChange → MongoDB ADTool, периодическая задача (интервал в часах)
├── routes/
│   ├── routes.js       # Подключение маршрутов
│   ├── authRouter.js   # POST /login, GET /adress, POST /access
│   ├── feedBackRoutes.js # POST /feedback (multer — загрузка изображения), маршруты по обратной связи
│   ├── sqlRoutes.js    # GET /getsqldata, /startinterval, /stopinterval, /intervaltime, /getdatanow, /allpdoka
│   └── websocket-routes.js # Обработчики сообщений WS (msgHandler): getCollectionMongoose, insert/update/delete, getAllClientsIp и т.д.
├── helper/
│   └── Logger.js       # Winston + daily rotate (логи в logs/)
├── uploads/            # Загруженные файлы (например, изображения обратной связи), в .gitignore
├── logs/               # Логи приложения, в .gitignore
└── .env                # Не в репозитории; см. пример выше
```

---

## Навыки, отражённые в проекте

- **Backend на Node.js / Express:** REST API, маршрутизация, middleware (cors, body-parser, cookie-parser), статика.
- **Базы данных:** MongoDB (Mongoose: схемы, ref, pre-хуки при удалении, каскадное обновление ссылок), MS SQL Server (подключение, запросы, таймауты, батчевая вставка в MongoDB).
- **Реальное время:** WebSocket (ws), аутентификация по JWT из cookie, разграничение по ролям, MongoDB Change Streams и broadcast клиентам.
- **Безопасность:** JWT, httpOnly + SameSite cookies, CORS, RBAC (admin/manager), проверка прав на каждое действие по WS.
- **Надёжность:** обработка ошибок, логирование (Winston, ротация), корректное закрытие соединений (SQL, Mongo), перезапуск Change Stream при падении MongoDB (в т.ч. перезапуск службы MongoDB через PowerShell).
- **Файлы и медиа:** загрузка файлов (Multer), ограничение типа (jpeg/png) и размера.
- **Организация кода:** разделение на маршруты, сервис БД, конфигурация через .env, единый логгер.

---

## Лицензия и автор

- **Автор:** TsyhanokYS  
- **Лицензия:** ISC  
- **Описание в package.json:** «ведение и аудит реестра АД»

---
