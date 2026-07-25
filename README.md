# Lampa Plugins

Коллекция плагинов для [Lampa](http://lampa.mx) — медиа-платформы для просмотра фильмов и сериалов.

## 📦 Плагины

### 1. Source Plugin — мульти-источник (`source_plugin.js`)

Прямой парсер DLE-сайтов. Не требует внешних серверов или авторизации.

**Источники:** Kinogo, Lordfilm, Baskino, Kinokrad

```url
https://cdn.jsdelivr.net/gh/Goodbrvtb/Lampa_plugins@feature/lampac_balancer/source_plugin.js
```

| Возможность | Описание |
|-------------|----------|
| 🔍 Поиск | По названию фильма на 4 сайтах одновременно |
| 🔄 Авто-переключение | Если на одном сайте пусто — пробует следующий |
| 🎬 Плееры | Извлекает iframe/data-src ссылки |
| 🔧 Настройка | Выбор источника в интерфейсе |

---

### 2. Lampac Balancer (`lampac_balancer.js`)

Подключается к Lampac-серверам для поиска источников через WebSocket/HTTP.

```url
https://cdn.jsdelivr.net/gh/Goodbrvtb/Lampa_plugins@feature/lampac_balancer/lampac_balancer.js
```

| Возможность | Описание |
|-------------|----------|
| 🌐 Серверы | beta.l-vid.online, skaz.tv (x4) |
| ⚡ Ping | Автовыбор быстрейшего сервера |
| 🔐 CUB | Поддержка авторизации через CUB-аккаунт |
| 🔄 Retry | 6 попыток с переключением серверов |

> ⚠️ Требует входа в CUB: Настройки → Синхронизация → Войти через CUB

---

### 3. Kinogo Parser (`kinogo.js`)

Специализированный парсер для kinogo.ec (DLE). Поиск + извлечение плееров.

```url
https://cdn.jsdelivr.net/gh/Goodbrvtb/Lampa_plugins@feature/lampac_balancer/kinogo.js
```

---

## 🚀 Быстрый старт

1. Откройте Lampa → Настройки → Расширения → **Добавить плагин**
2. Вставьте ссылку на нужный плагин
3. Нажмите «Готово»

## 📝 Архитектура плагинов

Три типа плагинов для онлайн-просмотра:

| Тип | Пример | Принцип |
|-----|--------|---------|
| **Source** | `source_plugin.js` | Парсит HTML сайтов, извлекает ссылки |
| **Balancer** | `lampac_balancer.js` | Запрашивает Lampac-сервер → получает ссылки |
| **API** | `kinogo.js` | Комбинированный: поиск DLE + iframe-плееры |

### Структура плагина

```js
(function () {
  "use strict";

  // 1. Манифест (синхронно!)
  var manifest = { type: "video", component: "...", ... };
  Lampa.Manifest.plugins = manifest;

  // 2. Компонент
  function Component(object) {
    // Lampa.Explorer + Lampa.Filter + Lampa.Scroll
    this.create = function () { ... };
    this.render = function () { ... };
    this.start  = function () { ... };
    this.destroy = function () {};
  }

  // 3. Запуск (сразу, без appready)
  function startPlugin() {
    Lampa.Component.add("...", Component);
    // кнопка + listener
  }
  if (!window.__plugin_ready) startPlugin();
})();
```

### Ключевые правила Lampa API

| API | Правильно | Неправильно |
|-----|-----------|-------------|
| HTTP-запросы | `new Lampa.Reguest()` | ~~`new Lampa.Request()`~~ |
| Событие full | `e.type === "complite"` | ~~`e.type === "complete"`~~ |
| Манифест | `onContextLauch` | ~~`onContextLaunch`~~ |
| JSON ответ | `secuses` | ~~`success`~~ |
| HTML запрос | `{ dataType: "text" }` | Без параметра (по умолчанию JSON) |
| CDN | `jsDelivr` | `raw.githubusercontent.com` |

### Жизненный цикл компонента

```
create() → render() → start() → ... → destroy()
   │          │          │
   ▼          ▼          ▼
initialize  files.render  reset + search
```

## 🔧 Разработка

```bash
git clone https://github.com/Goodbrvtb/Lampa_plugins.git
cd Lampa_plugins
# Ветка: feature/lampac_balancer
```

### Отладка

1. Откройте Lampa → F12 → Console
2. Логи плагинов: `Kinogo`, `Source`, `Lampac`
3. Тестовый URL: `http://lampa.mx/?card=1108427&media=movie&source=tmdb`

## 📋 Contributing

1. Форкните репозиторий
2. Создайте ветку: `feature/your-plugin`
3. Добавьте плагин, следуя структуре выше
4. Используйте jsDelivr для тестирования: `https://cdn.jsdelivr.net/gh/Goodbrvtb/Lampa_plugins@BRANCH/FILE.js`
5. Создайте Pull Request
