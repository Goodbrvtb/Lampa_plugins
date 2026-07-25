/**
 * Lampa Source Plugin — мульти-источник
 * 
 * Прямой парсинг DLE-сайтов для извлечения ссылок на видео.
 * Не требует внешних серверов или авторизации.
 * 
 * Поддерживаемые источники:
 * - Kinogo (kinogo.ec)
 * - Lordfilm (lordfilm2.org)
 * - Baskino (baskino.me)
 * - Kinokrad (kinokrad.co)
 * 
 * @version 1.1.0
 */

(function () {
  "use strict";

  // ============================================================
  // НАСТРОЙКИ ИСТОЧНИКОВ (DLE-сайты)
  // ============================================================
  var SOURCES = [
    {
      name: "Kinogo",
      baseUrl: "https://kinogo.ec",
      searchPath: "/index.php?do=search&subaction=search&story=",
      selectors: {
        results: ".story, .short-story, article",
        link: 'a[href*=".html"]',
        title: 'a[href*=".html"]',
        poster: "img",
        year: 'a[href*="year-teg"]',
        rating: '[class*="rating"], [class*="vote"]',
      },
      playerRegex: /<li[^>]*data-provider\s*=\s*["'](\d+)["'][^>]*data-src\s*=\s*["']([^"']+)["']/gi,
    },
    {
      name: "Lordfilm",
      baseUrl: "https://lordfilm2.org",
      searchPath: "/index.php?do=search&subaction=search&story=",
      selectors: {
        results: ".th-item, .shortstory, .story",
        link: 'a[href*=".html"]',
        title: 'a[href*=".html"]',
        poster: "img",
        year: "",
        rating: "",
      },
      playerRegex: /<iframe[^>]*data-src\s*=\s*["']([^"']+)["']/gi,
    },
    {
      name: "Baskino",
      baseUrl: "https://baskino.me",
      searchPath: "/index.php?do=search&subaction=search&story=",
      selectors: {
        results: ".story, .short-story, .item",
        link: 'a[href*=".html"]',
        title: 'a[href*=".html"]',
        poster: "img",
        year: "",
        rating: "",
      },
      playerRegex: /<iframe[^>]*data-src\s*=\s*["']([^"']+)["']/gi,
    },
    {
      name: "Kinokrad",
      baseUrl: "https://kinokrad.co",
      searchPath: "/index.php?do=search&subaction=search&story=",
      selectors: {
        results: ".story, .short-story, .item",
        link: 'a[href*=".html"]',
        title: 'a[href*=".html"]',
        poster: "img",
        year: "",
        rating: "",
      },
      playerRegex: /<iframe[^>]*data-src\s*=\s*["']([^"']+)["']/gi,
    },
  ];

  var activeSource = SOURCES[0];
  var COMPONENT = "dle_source";

  // ============================================================
  // МАНИФЕСТ (регистрируется синхронно)
  // ============================================================
  var manifest = {
    type: "video",
    version: "1.1.0",
    name: "DLE Source",
    description: "Поиск на Kinogo, Lordfilm, Baskino, Kinokrad",
    component: COMPONENT,
    icon:
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M8 5v14l11-7z"/></svg>',
    onContextMenu: function () {
      return { name: "Смотреть онлайн (Source)", description: "" };
    },
    onContextLauch: function (object) {
      Lampa.Component.add(COMPONENT, SourceComponent);
      Lampa.Activity.push({
        url: "",
        title: "Поиск",
        component: COMPONENT,
        search: object.title,
        movie: object,
        page: 1,
      });
    },
  };

  Lampa.Manifest.plugins = manifest;

  // ============================================================
  // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ============================================================

  function getProxy() {
    var p = Lampa.Storage.get("online_proxy_all", "");
    var cp = Lampa.Storage.get("online_proxy_" + COMPONENT, "");
    if (cp) p = cp;
    if (p && p.slice(-1) !== "/") p += "/";
    return p;
  }

  function proxyUrl(url) {
    var p = getProxy();
    return p ? p + url : url;
  }

  function makeUrl(path) {
    return path.indexOf("http") === 0 ? path : activeSource.baseUrl + path;
  }

  // ============================================================
  // КОМПОНЕНТ ИСТОЧНИКА
  // ============================================================

  function SourceComponent(object) {
    var network = new Lampa.Reguest();
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var results = [];
    var retryCount = 0;
    var maxRetries = SOURCES.length;

    // --- HTTP-запрос ---
    function fetchHTML(url, onsuccess, onerror) {
      network.native(
        proxyUrl(url),
        onsuccess,
        onerror || function () {},
        false,
        { dataType: "text" },
      );
    }

    // --- Парсинг результатов (универсальный для всех DLE) ---
    function parseSearchResults(html) {
      var items = [];
      var sel = activeSource.selectors;
      try {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var elements = doc.querySelectorAll(sel.results);
        if (elements.length === 0) {
          // Fallback: regex для жёсткого парсинга
          var regex = /<a[^>]*href="([^"]*\.html)"[^>]*>([^<]+)<\/a>/gi;
          var m;
          while ((m = regex.exec(html)) !== null) {
            items.push({
              id: Lampa.Utils.hash(m[1]),
              title: m[2].replace(/\s*\(\d{4}\)/, "").trim(),
              year: (m[2].match(/\((\d{4})\)/) || [])[1] || "",
              url: makeUrl(m[1]),
              poster: "",
              source: activeSource.name,
            });
          }
          return items;
        }

        elements.forEach(function (el) {
          var link = el.querySelector(sel.link);
          if (!link) return;
          var href = link.getAttribute("href");
          var title = link.textContent.trim();
          var img = el.querySelector(sel.poster);
          var poster = img ? (img.getAttribute("src") || img.getAttribute("data-src") || "") : "";
          var year = (title.match(/\((\d{4})\)/) || [])[1] || "";
          if (sel.year) {
            var yEl = el.querySelector(sel.year);
            if (yEl) year = yEl.textContent.trim() || year;
          }

          if (title && href && href.indexOf(".html") > 0) {
            items.push({
              id: Lampa.Utils.hash(href),
              title: title.replace(/\s*\(\d{4}\)/, "").trim(),
              year: year,
              url: makeUrl(href),
              poster: poster.indexOf("http") === 0 ? poster : "",
              source: activeSource.name,
            });
          }
        });
      } catch (e) {
        console.log("Source", "Parse error:", e);
      }
      return items;
    }

    // --- Парсинг плееров ---
    function parsePlayers(html) {
      var players = [];
      var regex = activeSource.playerRegex;
      var m;
      while ((m = regex.exec(html)) !== null) {
        players.push({ url: (m[1] || m[2]).replace(/&amp;/g, "&") });
      }
      return players;
    }

    // --- Поиск ---
    function doSearch(query, callback) {
      fetchHTML(
        makeUrl(activeSource.searchPath + encodeURIComponent(query)),
        function (html) { callback(parseSearchResults(html)); },
        function () { callback([]); },
      );
    }

    // --- Получение видео ---
    function getVideoUrl(pageUrl, callback) {
      fetchHTML(pageUrl, function (html) {
        var players = parsePlayers(html);
        if (players.length > 0) {
          callback({ url: players[0].url, player: "iframe", title: activeSource.name });
        } else {
          callback({ url: pageUrl, player: "redirect" });
        }
      }, function () {
        callback({ url: pageUrl, player: "redirect" });
      });
    }

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================

    this.initialize = function () {
      var self = this;
      self.loading(true);

      filter.onSearch = function (value) {
        Lampa.Activity.replace({
          search: value,
          clarification: true,
          similar: true,
        });
      };

      filter.onBack = function () { self.start(); };
      if (filter.addButtonBack) filter.addButtonBack();

      // Переключение источников
      filter.set("sort", SOURCES.map(function (s, i) {
        return { title: s.name, source: i, selected: s === activeSource };
      }));
      filter.chosen("sort", [activeSource.name]);

      filter.onSelect = function (type, a, b) {
        if (type === "sort") {
          activeSource = SOURCES[b.source];
          retryCount = 0;
          filter.chosen("sort", [activeSource.name]);
          Lampa.Select.close();
          self.reset();
          self.performSearch();
        }
      };

      filter.render().find(".filter--sort span").text("Источник");

      scroll.body().addClass("torrent-list");
      files.appendFiles(scroll.render());
      files.appendHead(filter.render());
      scroll.minus(files.render().find(".explorer__files-head"));
      scroll.body().append(
        $('<div class="online-empty"><div class="broadcast__scan"><div></div></div></div>'),
      );
      Lampa.Controller.enable("content");
      self.loading(false);
      self.performSearch();
    };

    this.performSearch = function () {
      var self = this;
      var query = object.search || object.movie.title || object.movie.name || "";
      console.log("Source [" + activeSource.name + "]", "Search:", query);

      doSearch(query, function (items) {
        results = items;
        if (items.length > 0) {
          retryCount = 0;
          self.displayResults(items);
        } else if (retryCount < maxRetries - 1) {
          // Авто-переключение на следующий источник
          retryCount++;
          var idx = SOURCES.indexOf(activeSource);
          activeSource = SOURCES[(idx + 1) % SOURCES.length];
          console.log("Source", "No results, switching to:", activeSource.name);
          filter.chosen("sort", [activeSource.name]);
          self.performSearch();
        } else {
          self.showEmpty();
        }
      });
    };

    // --- Отображение результатов ---
    this.displayResults = function (items) {
      var self = this;
      scroll.clear();

      items.forEach(function (item) {
        item.info = item.year || "";
        item.time = "";

        var tmpl = Lampa.Template.get("source_result_item", item);
        if (item.poster) {
          Lampa.Utils.imgLoad(tmpl.find("img"), item.poster);
        }
        tmpl.on("hover:enter", function () {
          self.loadVideo(item);
        });
        scroll.append(tmpl);
      });
    };

    // --- Загрузка и воспроизведение ---
    this.loadVideo = function (item) {
      Lampa.Loading.start(function () {
        Lampa.Loading.stop();
        Lampa.Controller.toggle("content");
      });
      console.log("Source", "Load video:", item.url, "from", item.source);
      getVideoUrl(item.url, function (result) {
        Lampa.Loading.stop();
        if (result.url) {
          Lampa.Player.play({
            title: item.title,
            url: result.url,
            player: result.player,
            isonline: true,
          });
        } else {
          Lampa.Noty.show("Не удалось получить ссылку");
        }
      });
    };

    // --- Пустой результат ---
    this.showEmpty = function () {
      scroll.clear();
      scroll.append(
        $(
          '<div class="online-empty">' +
            '<div class="online-empty__title">Ничего не найдено</div>' +
            '<div class="online-empty__subtitle">' +
            'CORS-ошибка? Настройте прокси:<br>' +
            'Настройки → Прокси → укажите https://corsproxy.io/?' +
            '</div>' +
            "</div>",
        ),
      );
    };

    this.loading = function (state) {
      this.activity.loader(state);
    };

    this.reset = function () {
      scroll.clear();
    };

    // ============================================================
    // ЖИЗНЕННЫЙ ЦИКЛ
    // ============================================================

    this.render = function () {
      return files.render();
    };

    this.create = function () {
      this.initialize();
      return this.render();
    };

    this.start = function () {
      this.reset();
      this.initialize();
    };

    this.destroy = function () {};
  }

  // ============================================================
  // ТЕМПЛЕЙТ
  // ============================================================

  function resetTemplates() {
    Lampa.Template.add(
      "source_result_item",
      '<div class="online-prestige online-prestige--full selector">' +
        '<div class="online-prestige__img">' +
        '<img alt=""><div class="online-prestige__loader"></div>' +
        "</div>" +
        '<div class="online-prestige__body">' +
        '<div class="online-prestige__head">' +
        '<div class="online-prestige__title">{title}</div>' +
        '<div class="online-prestige__time">{time}</div>' +
        "</div>" +
        '<div class="online-prestige__footer">' +
        '<div class="online-prestige__info">{info}</div>' +
        "</div></div></div>",
    );
  }

  // ============================================================
  // ЗАПУСК
  // ============================================================

  function startPlugin() {
    if (window["__plugin_" + COMPONENT]) return;
    window["__plugin_" + COMPONENT] = true;

    resetTemplates();
    Lampa.Component.add(COMPONENT, SourceComponent);

    var button =
      '<div class="full-start__button selector view--online ' + COMPONENT +
      '--button" data-subtitle="DLE Source v1.1">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M8 5v14l11-7z"/></svg>' +
      "<span>Source</span></div>";

    function addButton(e) {
      if (e.render.find("." + COMPONENT + "--button").length) return;
      var btn = $(button);
      btn.on("hover:enter", function () {
        Lampa.Component.add(COMPONENT, SourceComponent);
        Lampa.Activity.push({
          url: "",
          title: "Поиск",
          component: COMPONENT,
          search: e.movie.title,
          movie: e.movie,
          page: 1,
        });
      });
      e.render.after(btn);
    }

    Lampa.Listener.follow("full", function (e) {
      if (e.type === "complite") {
        addButton({
          render: e.object.activity.render().find(".view--torrent"),
          movie: e.data.movie,
        });
      }
    });

    try {
      if (Lampa.Activity.active().component === "full") {
        addButton({
          render: Lampa.Activity.active().activity.render().find(".view--torrent"),
          movie: Lampa.Activity.active().card,
        });
      }
    } catch (e) {}
  }

  if (!window["__plugin_" + COMPONENT]) startPlugin();
})();
