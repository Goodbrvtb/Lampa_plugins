/**
 * Kinogo Plugin for Lampa
 *
 * Добавляет kinogo.ec как источник для поиска и просмотра фильмов и сериалов.
 *
 * Установка:
 * Настройки → Расширения → Добавить плагин → указать URL плагина
 *
 * Архитектура kinogo.ec:
 * - DLE (DataLife Engine) сайт с Cloudflare защитой
 * - Плееры хранятся в <li data-provider="X" data-src="URL">
 * - Поиск: https://kinogo.ec/index.php?do=search&subaction=search&story=QUERY
 *
 * @version 0.2.0
 */

(function () {
  "use strict";

  var network = new Lampa.Reguest();
  var BASE_URL = "https://kinogo.ec";
  var SEARCH_URL = BASE_URL + "/index.php?do=search&subaction=search&story=";
  var COMPONENT = "kinogo";

  // ============================================================
  // Прокси: берём из настроек Lampa (Настройки → Прокси)
  // ============================================================
  function getProxy() {
    var proxy = Lampa.Storage.get("online_proxy_all", "");
    var kinogoProxy = Lampa.Storage.get("online_proxy_" + COMPONENT, "");
    if (kinogoProxy) proxy = kinogoProxy;
    if (proxy && proxy.slice(-1) !== "/") proxy += "/";
    return proxy;
  }

  function proxyUrl(url) {
    var p = getProxy();
    return p ? p + url : url;
  }

  // ============================================================
  // Выполнение запроса с правильным dataType и прокси
  // ============================================================
  function requestHTML(url, onsuccess, onerror) {
    var fullUrl = proxyUrl(url);
    console.log("Kinogo", "Request:", fullUrl);
    network.native(fullUrl, onsuccess, onerror, false, { dataType: "text" });
  }

  // ============================================================
  // Регистрация плагина
  // ============================================================
  var manifest = {
    type: "balancer",
    version: "0.2.0",
    name: "Kinogo",
    description: "Поиск и просмотр фильмов с kinogo.ec",
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    component: COMPONENT,
  };

  function startPlugin() {
    Lampa.Manifest.plugins = manifest;

    // ============================================================
    // Настройки плагина
    // ============================================================
    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        type: "title",
      },
      field: {
        name: "Kinogo.ec",
      },
    });

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        type: "select",
        name: "kinogo_player",
        default: "0",
      },
      field: {
        name: "Плеер по умолчанию",
        description: "Выбор плеера для просмотра",
      },
      variants: [
        { id: "0", name: "Основной (Смотреть онлайн)" },
        { id: "1", name: "Плеер 1" },
        { id: "3", name: "Плеер 3" },
      ],
    });

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        type: "select",
        name: "kinogo_proxy",
        default: "0",
      },
      field: {
        name: "Прокси для Kinogo",
        description:
          "Если сайт заблокирован, выберите прокси (нужна настройка в Настройки → Прокси)",
      },
      variants: [
        { id: "0", name: "Без прокси" },
        { id: "1", name: "Использовать глобальный прокси" },
      ],
    });

    // ============================================================
    // Компонент поиска/категории (категория в меню)
    // ============================================================
    function component(object) {
      var comp = new Lampa.InteractionCategory(object);

      comp.create = function () {
        var self = this;
        self.activity.loader(true);

        // Загружаем популярные/новинки
        requestHTML(
          BASE_URL + "/v1new/",
          function (html) {
            var items = parseCatalogPage(html);
            if (items.length > 0) {
              self.build(items);
            } else {
              self.empty();
            }
            self.activity.loader(false);
          },
          function () {
            self.empty();
            self.activity.loader(false);
          },
        );
      };

      comp.nextPageRequest = function (object, resolve, reject) {
        resolve([]);
      };

      return comp;
    }

    // ============================================================
    // Парсинг HTML страницы каталога
    // ============================================================
    function parseCatalogPage(html) {
      var items = [];
      try {
        // Используем DOMParser если доступен
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, "text/html");

        // Ищем элементы фильмов на странице
        var movieElements = doc.querySelectorAll(
          '.sect-story, .story, [class*="short-story"], article',
        );

        movieElements.forEach(function (el) {
          var link = el.querySelector('a[href*="kinogo.ec/"]');
          if (!link) link = el.querySelector('a[href*=".html"]');

          if (link) {
            var href = link.getAttribute("href");
            var title = link.textContent.trim();
            var img = el.querySelector("img");
            var imgSrc = img
              ? img.getAttribute("src") || img.getAttribute("data-src")
              : "";

            // Парсим рейтинг
            var ratingEl = el.querySelector(
              '[class*="rating"], [class*="vote"]',
            );
            var rating = ratingEl ? ratingEl.textContent.trim() : "";

            // Парсим метаданные
            var yearEl = el.querySelector('a[href*="year-teg"]');
            var year = yearEl ? yearEl.textContent.trim() : "";

            if (title && href) {
              items.push({
                id: Lampa.Utils.hash(href),
                title: title.replace(/\s*\(\d{4}\)/, "").trim(),
                year: year,
                url: href.startsWith("http") ? href : BASE_URL + href,
                poster: imgSrc || "",
                rating: rating,
                source: "kinogo",
              });
            }
          }
        });
      } catch (e) {
        console.log("Kinogo", "Parse error:", e);
        // Fallback: regex парсинг
        var regex =
          /<a[^>]*href="([^"]*kinogo\.ec\/[^"]*\.html)"[^>]*>([^<]+)<\/a>/gi;
        var match;
        while ((match = regex.exec(html)) !== null) {
          if (match[1] && match[2]) {
            var exists = items.some(function (item) {
              return item.url === match[1];
            });
            if (!exists) {
              items.push({
                id: Lampa.Utils.hash(match[1]),
                title: match[2]
                  .trim()
                  .replace(/\s*\(\d{4}\)/, "")
                  .trim(),
                url: match[1].startsWith("http")
                  ? match[1]
                  : BASE_URL + match[1],
                source: "kinogo",
              });
            }
          }
        }
      }
      return items;
    }

    // ============================================================
    // Парсинг страницы фильма (извлечение data-src из плееров)
    // ============================================================
    function parseMoviePage(html) {
      // Ищем плееры в <li data-provider data-src="..."> (порядок атрибутов любой)
      var liRegex =
        /<li[^>]*?((data-provider\s*=\s*["'](\d+)["'][^>]*?data-src\s*=\s*["']([^"']+)["'])|(data-src\s*=\s*["']([^"']+)["'][^>]*?data-provider\s*=\s*["'](\d+)["']))/gi;
      var players = [];
      var match;
      while ((match = liRegex.exec(html)) !== null) {
        var provider = parseInt(match[3] || match[7]);
        var url = (match[4] || match[6]).replace(/&amp;/g, "&");
        players.push({
          provider: provider,
          url: url,
        });
      }

      // Если не нашли через li, ищем iframe с data-src (lazy iframe)
      if (players.length === 0) {
        var iframeRegex = /<iframe[^>]*data-src\s*=\s*["']([^"']+)["']/gi;
        while ((match = iframeRegex.exec(html)) !== null) {
          players.push({
            provider: players.length,
            url: match[1].replace(/&amp;/g, "&"),
          });
        }
      }

      // Выбираем плеер по настройке
      var selectedPlayer = Lampa.Storage.get("kinogo_player", "0");
      var idx = parseInt(selectedPlayer) || 0;
      if (idx === 3) idx = 2;

      // Если выбранного индекса нет, берём первый доступный
      var playerUrl = "";
      var targetPlayer = null;
      for (var i = 0; i < players.length; i++) {
        if (players[i].provider === idx) {
          targetPlayer = players[i];
          break;
        }
      }
      if (!targetPlayer) targetPlayer = players[0];
      if (targetPlayer) playerUrl = targetPlayer.url;

      return {
        iframeSrc: playerUrl,
        players: players,
      };
    }

    // ============================================================
    // Поиск (вызывается из Lampa при поиске)
    // ============================================================
    function search(query, oncomplete, onerror) {
      console.log("Kinogo", "Searching for:", query);

      requestHTML(
        SEARCH_URL + encodeURIComponent(query),
        function (html) {
          var items = parseSearchResults(html);
          oncomplete({
            success: true,
            page: 1,
            results: items,
          });
        },
        function (err) {
          console.log("Kinogo", "Search error:", err);
          oncomplete({
            success: true,
            page: 1,
            results: [],
          });
        },
      );
    }

    // ============================================================
    // Парсинг результатов поиска
    // ============================================================
    function parseSearchResults(html) {
      var items = [];
      try {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, "text/html");

        // Ищем результаты поиска
        var resultElements = doc.querySelectorAll(
          '.story, .short-story, article, [class*="story"]',
        );

        resultElements.forEach(function (el) {
          var link = el.querySelector('a[href*=".html"]');
          if (!link) return;

          var href = link.getAttribute("href");
          var title = link.textContent.trim();
          var img = el.querySelector("img");
          var imgSrc = img
            ? img.getAttribute("src") || img.getAttribute("data-src")
            : "";

          // Извлекаем год
          var yearMatch = title.match(/\((\d{4})\)/);
          var year = yearMatch ? yearMatch[1] : "";

          // Извлекаем рейтинг
          var ratingEl = el.querySelector('[class*="rating"], [class*="vote"]');
          var rating = ratingEl ? ratingEl.textContent.trim() : "";

          // Извлекаем тип (фильм/сериал)
          var type = "movie";
          if (
            title.toLowerCase().indexOf("сезон") >= 0 ||
            title.toLowerCase().indexOf("serial") >= 0 ||
            title.toLowerCase().indexOf("season") >= 0
          ) {
            type = "tv";
          }

          if (title && href && href.indexOf(".html") > 0) {
            items.push({
              id: Lampa.Utils.hash(href),
              title: title.replace(/\s*\(\d{4}\)/, "").trim(),
              year: year,
              url: href.startsWith("http") ? href : BASE_URL + href,
              poster: imgSrc || "",
              rating: rating,
              type: type,
              source: "kinogo",
            });
          }
        });
      } catch (e) {
        console.log("Kinogo", "Parse search error:", e);
      }
      return items;
    }

    // ============================================================
    // Получение ссылки на видео по URL страницы
    // ============================================================
    function getVideo(url, oncomplete) {
      console.log("Kinogo", "Getting video from:", url);

      requestHTML(
        url,
        function (html) {
          var player = parseMoviePage(html);

          if (player.iframeSrc) {
            console.log("Kinogo", "Found player URL:", player.iframeSrc);
            oncomplete({
              success: true,
              url: player.iframeSrc,
              player: "iframe",
              title: "Kinogo",
            });
          } else {
            console.log(
              "Kinogo",
              "No player found on page, fallback to redirect",
            );
            oncomplete({
              success: true,
              url: url,
              player: "redirect",
              title: "Kinogo",
            });
          }
        },
        function () {
          console.log("Kinogo", "Failed to load movie page");
          oncomplete({
            success: false,
          });
        },
      );
    }

    // ============================================================
    // Поиск фильма на Kinogo по названию и получение URL плеера
    // ============================================================
    function getLinkByTitle(object, oncomplete) {
      var title = object.title || "";
      var year = object.year || "";

      if (!title) {
        oncomplete({ success: false });
        return;
      }

      console.log("Kinogo", "Searching by title:", title, year);

      requestHTML(
        SEARCH_URL + encodeURIComponent(title),
        function (html) {
          var results = parseSearchResults(html);

          // Ищем совпадение по году, если он указан
          var found = null;
          if (year) {
            for (var i = 0; i < results.length; i++) {
              if (
                results[i].year === year ||
                results[i].title.toLowerCase() === title.toLowerCase()
              ) {
                found = results[i];
                break;
              }
            }
          }

          // Если не нашли по году, берём первый результат
          if (!found && results.length > 0) {
            found = results[0];
          }

          if (found && found.url) {
            console.log(
              "Kinogo",
              "Found movie on kinogo:",
              found.title,
              found.url,
            );
            getVideo(found.url, oncomplete);
          } else {
            console.log("Kinogo", "No results found for:", title);
            oncomplete({ success: false });
          }
        },
        function () {
          console.log("Kinogo", "Search request failed for:", title);
          oncomplete({ success: false });
        },
      );
    }

    // ============================================================
    // Регистрация балансера (источника)
    // ============================================================
    Lampa.Balancer.add({
      name: "Kinogo",
      search: function (query, oncomplete, onerror) {
        search(query, oncomplete, onerror);
      },
      getLink: function (object, oncomplete) {
        var url = object.url;

        // Если есть прямой URL от kinogo, используем его
        if (url && url.indexOf("kinogo") >= 0) {
          getVideo(url, oncomplete);
        } else if (object.title) {
          // Если нет URL, но есть название — ищем на kinogo по названию
          getLinkByTitle(object, oncomplete);
        } else {
          oncomplete({ success: false });
        }
      },
    });

    // ============================================================
    // Обработка клика по результату поиска
    // ============================================================
    Lampa.Listener.follow("full", function (event) {
      if (event.type === "complite" && event.data && event.data.movie) {
        var movie = event.data.movie;
        if (movie.source === "kinogo" && movie.url) {
          // Добавляем кнопку для открытия на Kinogo
          // (Плагин уже зарегистрирован как балансер)
        }
      }
    });

    console.log("Kinogo", "Plugin started");
  }

  // ============================================================
  // Запуск
  // ============================================================
  if (window.appready) {
    startPlugin();
  } else {
    Lampa.Listener.follow("app", function (e) {
      if (e.type === "ready") {
        startPlugin();
      }
    });
  }
})();
