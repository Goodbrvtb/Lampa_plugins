/**
 * Lampa Source Plugin — универсальный плагин-парсер
 * 
 * Прямой парсинг сайта-источника для извлечения ссылок на видео.
 * Не требует внешних серверов или авторизации.
 * 
 * @version 1.0.0
 */

(function () {
  "use strict";

  // ============================================================
  // НАСТРОЙКИ ИСТОЧНИКА (меняйте под свой сайт)
  // ============================================================
  var CONFIG = {
    name: "Kinogo",
    component: "kinogo_source",
    baseUrl: "https://kinogo.ec",
    searchUrl: "/index.php?do=search&subaction=search&story=",
    // CSS-селекторы для парсинга
    selectors: {
      searchResults: ".story, .short-story, article",
      itemLink: 'a[href*=".html"]',
      itemTitle: 'a[href*=".html"]',
      itemPoster: "img",
      playerContainer: 'li[data-provider][data-src]',
    },
  };

  // ============================================================
  // МАНИФЕСТ (регистрируется синхронно)
  // ============================================================
  var manifest = {
    type: "video",
    version: "1.0.0",
    name: CONFIG.name + " Source",
    description: "Прямой поиск на " + CONFIG.baseUrl,
    component: CONFIG.component,
    icon:
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M8 5v14l11-7z"/></svg>',
    onContextMenu: function () {
      return { name: "Смотреть на " + CONFIG.name, description: "" };
    },
    onContextLauch: function (object) {
      Lampa.Component.add(CONFIG.component, SourceComponent);
      Lampa.Activity.push({
        url: "",
        title: CONFIG.name,
        component: CONFIG.component,
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
    var cp = Lampa.Storage.get("online_proxy_" + CONFIG.component, "");
    if (cp) p = cp;
    if (p && p.slice(-1) !== "/") p += "/";
    return p;
  }

  function proxyUrl(url) {
    var p = getProxy();
    return p ? p + url : url;
  }

  function makeUrl(path) {
    return path.indexOf("http") === 0 ? path : CONFIG.baseUrl + path;
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

    // --- Парсинг результатов поиска ---
    function parseSearchResults(html) {
      var items = [];
      try {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var elements = doc.querySelectorAll(CONFIG.selectors.searchResults);

        elements.forEach(function (el) {
          var link = el.querySelector(CONFIG.selectors.itemLink);
          if (!link) return;

          var href = link.getAttribute("href");
          var title = link.textContent.trim();
          var img = el.querySelector(CONFIG.selectors.itemPoster);
          var poster = img
            ? img.getAttribute("src") || img.getAttribute("data-src") || ""
            : "";
          var year = (title.match(/\((\d{4})\)/) || [])[1] || "";

          if (title && href) {
            items.push({
              id: Lampa.Utils.hash(href),
              title: title.replace(/\s*\(\d{4}\)/, "").trim(),
              year: year,
              url: makeUrl(href),
              poster: poster.indexOf("http") === 0 ? poster : "",
              source: CONFIG.component,
            });
          }
        });
      } catch (e) {
        console.log(CONFIG.name, "Parse error:", e);
      }
      return items;
    }

    // --- Парсинг плееров на странице фильма ---
    function parsePlayers(html) {
      var players = [];
      var regex =
        /<li[^>]*data-provider\s*=\s*["'](\d+)["'][^>]*data-src\s*=\s*["']([^"']+)["']/gi;
      var m;
      while ((m = regex.exec(html)) !== null) {
        players.push({
          provider: parseInt(m[1]),
          url: m[2].replace(/&amp;/g, "&"),
        });
      }
      return players;
    }

    // --- Поиск ---
    function doSearch(query, callback) {
      fetchHTML(
        makeUrl(CONFIG.searchUrl + encodeURIComponent(query)),
        function (html) {
          callback(parseSearchResults(html));
        },
        function () {
          callback([]);
        },
      );
    }

    // --- Получение видео ---
    function getVideoUrl(pageUrl, callback) {
      fetchHTML(
        pageUrl,
        function (html) {
          var players = parsePlayers(html);
          if (players.length > 0) {
            callback({
              url: players[0].url,
              player: "iframe",
              title: CONFIG.name,
            });
          } else {
            callback({ url: pageUrl, player: "redirect" });
          }
        },
        function () {
          callback({ url: pageUrl, player: "redirect" });
        },
      );
    }

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================

    this.initialize = function () {
      var self = this;
      self.loading(true);

      filter.onBack = function () {
        self.start();
      };

      if (filter.addButtonBack) filter.addButtonBack();
      filter.render().find(".filter--sort span").text("Источник: " + CONFIG.name);

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
      console.log(CONFIG.name, "Search:", query);

      doSearch(query, function (items) {
        results = items;
        if (items.length > 0) {
          self.displayResults(items);
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
      var self = this;
      Lampa.Loading.start(function () {
        Lampa.Loading.stop();
        Lampa.Controller.toggle("content");
      });

      console.log(CONFIG.name, "Load video:", item.url);
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
            '<div class="online-empty__title">Ничего не найдено на ' +
            CONFIG.name +
            "</div>" +
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
    if (window["__plugin_" + CONFIG.component]) return;
    window["__plugin_" + CONFIG.component] = true;

    resetTemplates();
    Lampa.Component.add(CONFIG.component, SourceComponent);

    // Кнопка в карточке фильма
    var button =
      '<div class="full-start__button selector view--online ' +
      CONFIG.component +
      '--button" data-subtitle="' +
      CONFIG.name +
      ' Source">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M8 5v14l11-7z"/></svg>' +
      "<span>" +
      CONFIG.name +
      "</span></div>";

    function addButton(e) {
      if (e.render.find("." + CONFIG.component + "--button").length) return;
      var btn = $(button);
      btn.on("hover:enter", function () {
        Lampa.Component.add(CONFIG.component, SourceComponent);
        Lampa.Activity.push({
          url: "",
          title: CONFIG.name,
          component: CONFIG.component,
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

  if (!window["__plugin_" + CONFIG.component]) startPlugin();
})();
