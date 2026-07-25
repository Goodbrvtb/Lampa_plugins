/**
 * Lampac Balancer Plugin for Lampa
 *
 * Умный плагин для просмотра фильмов и сериалов через Lampac-балансеры.
 *
 * Архитектура:
 * - Подключается к нескольким Lampac-серверам (балансерам)
 * - Использует WebSocket (nws) для эффективной коммуникации
 * - Поддерживает CORS Proxy (Cloudflare Workers, Deno, Render)
 * - Автоматически переключает источники при недоступности
 * - Получает прямые ссылки на видео (MP4, HLS) без самостоятельного парсинга
 *
 * @version 1.0.0
 */

(function () {
  "use strict";

  // ============================================================
  // НАСТРОЙКИ БАЛАНСЕРОВ
  // ============================================================

  var BALANCER_SERVERS = [
    "http://hdpoisk.ru:2053",
    "http://78.40.199.67:10630",
    "http://144.124.224.240:11175",
  ];

  // CORS Proxy сервисы для обхода ограничений
  var CORS_PROXIES = {
    cloudflare1: "https://cors.nb557.workers.dev/",
    cloudflare2: "https://cors.fx666.workers.dev/",
    cloudflare3: "https://cors.kp556.workers.dev:8443/",
    deno: "https://cors557.deno.dev/",
    render: "https://apn-latest.onrender.com/",
  };

  // ============================================================
  // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ============================================================

  function getRandomBalancer() {
    return BALANCER_SERVERS[
      Math.floor(Math.random() * BALANCER_SERVERS.length)
    ];
  }

  function getProxyUrl(name) {
    var ip = getMyIp() || "";
    var param_ip =
      Lampa.Storage.field("lampac_proxy_find_ip") === true
        ? "ip" + ip + "/"
        : "";

    // Пользовательский прокси
    var proxy_other = Lampa.Storage.field("lampac_proxy_other") === true;
    var proxy_other_url = proxy_other
      ? Lampa.Storage.field("lampac_proxy_other_url") || ""
      : "";
    if (proxy_other_url) {
      return proxy_other_url + param_ip;
    }

    // Выбор прокси в зависимости от имени
    var proxies = [
      CORS_PROXIES.cloudflare1,
      CORS_PROXIES.cloudflare2,
      CORS_PROXIES.cloudflare3,
      CORS_PROXIES.deno,
      CORS_PROXIES.render,
    ];

    // Чередуем прокси по часу для равномерной нагрузки
    var proxyIndex = new Date().getHours() % proxies.length;
    return proxies[proxyIndex] + param_ip;
  }

  var myIp = "";

  function getMyIp() {
    return myIp;
  }

  function setMyIp(ip) {
    myIp = ip;
  }

  function checkMyIp(network, onComplite) {
    var ip = getMyIp();
    if (ip) {
      onComplite();
      return;
    }

    network.clear();
    network.timeout(10000);
    network.silent(
      "https://api.ipify.org/?format=json",
      function (json) {
        if (json && json.ip) setMyIp(json.ip);
        onComplite();
      },
      function () {
        // Пробуем через прокси
        network.clear();
        network.timeout(10000);
        network.silent(
          getProxyUrl("ip") + "jsonip",
          function (json) {
            if (json && json.ip) setMyIp(json.ip);
            onComplite();
          },
          function () {
            onComplite();
          },
        );
      },
    );
  }

  function getAccountEmail() {
    return Lampa.Storage.get("account_email", "");
  }

  function getUnicId() {
    var uid = Lampa.Storage.get("lampac_unic_id", "");
    if (!uid) {
      uid = Lampa.Utils.uid(8).toLowerCase();
      Lampa.Storage.set("lampac_unic_id", uid);
    }
    return uid;
  }

  // ============================================================
  // WebSocket / NWS КЛИЕНТ
  // ============================================================

  var HOST_KEY = "lampac_hdpoisk";

  if (!window.lampac_nws) window.lampac_nws = {};
  if (!window.lampac_nws[HOST_KEY]) {
    window.lampac_nws[HOST_KEY] = {
      type: Lampa.Platform.is("android")
        ? "apk"
        : Lampa.Platform.is("tizen")
          ? "cors"
          : undefined,
      startTypeInvoke: false,
      rchRegistry: false,
      apkVersion: Lampa.Platform.is("android")
        ? (function () {
            try {
              return parseInt(AndroidJS.appVersion().split("-").pop());
            } catch (e) {
              return 0;
            }
          })()
        : 0,
    };
  }

  window.lampac_nws[HOST_KEY].typeInvoke = function (host, call) {
    if (!window.lampac_nws[HOST_KEY].startTypeInvoke) {
      window.lampac_nws[HOST_KEY].startTypeInvoke = true;

      var check = function (good) {
        window.lampac_nws[HOST_KEY].type = Lampa.Platform.is("android")
          ? "apk"
          : good
            ? "cors"
            : "web";
        call();
      };

      if (Lampa.Platform.is("android") || Lampa.Platform.is("tizen")) {
        check(true);
      } else {
        var net = new Lampa.Reguest();
        net.silent(
          host.indexOf(location.host) >= 0
            ? "https://github.com/"
            : host + "/cors/check",
          function () {
            check(true);
          },
          function () {
            check(false);
          },
          false,
          { dataType: "text" },
        );
      }
    } else {
      call();
    }
  };

  window.lampac_nws[HOST_KEY].Registry = function (client, startConnection) {
    window.lampac_nws[HOST_KEY].typeInvoke(getBalancerUrl(), function () {
      client.invoke(
        "RchRegistry",
        JSON.stringify({
          version: 149,
          host: location.host,
          rchtype: Lampa.Platform.is("android")
            ? "apk"
            : Lampa.Platform.is("tizen")
              ? "cors"
              : window.lampac_nws[HOST_KEY].type,
          apkVersion: window.lampac_nws[HOST_KEY].apkVersion,
          player: Lampa.Storage.field("player"),
        }),
      );

      if (client._shouldReconnect && window.lampac_nws[HOST_KEY].rchRegistry) {
        if (startConnection) startConnection();
        return;
      }

      window.lampac_nws[HOST_KEY].rchRegistry = true;

      client.on("RchRegistry", function () {
        if (startConnection) startConnection();
      });
    });
  };

  var currentBalancerUrl = getRandomBalancer();

  function getBalancerUrl() {
    return currentBalancerUrl;
  }

  function setBalancerUrl(url) {
    currentBalancerUrl = url;
  }

  function rchInvoke(json, call) {
    if (
      window.lampacNwsClient &&
      window.lampacNwsClient[HOST_KEY] &&
      window.lampacNwsClient[HOST_KEY]._shouldReconnect
    ) {
      call();
      return;
    }
    if (!window.lampacNwsClient) window.lampacNwsClient = {};
    if (
      window.lampacNwsClient[HOST_KEY] &&
      window.lampacNwsClient[HOST_KEY].socket
    ) {
      window.lampacNwsClient[HOST_KEY].socket.close();
    }
    window.lampacNwsClient[HOST_KEY] = new NativeWsClient(json.nws, {
      autoReconnect: false,
    });
    window.lampacNwsClient[HOST_KEY].on("Connected", function (connectionId) {
      window.lampac_nws[HOST_KEY].Registry(
        window.lampacNwsClient[HOST_KEY],
        function () {
          call();
        },
      );
    });
    window.lampacNwsClient[HOST_KEY].connect();
  }

  function rchRun(json, call) {
    if (typeof NativeWsClient === "undefined") {
      Lampa.Utils.putScript(
        [getBalancerUrl() + "/js/nws-client-es5.js?v18112025"],
        function () {},
        false,
        function () {
          rchInvoke(json, call);
        },
        true,
      );
    } else {
      rchInvoke(json, call);
    }
  }

  // ============================================================
  // ФОРМИРОВАНИЕ URL С ПАРАМЕТРАМИ
  // ============================================================

  function buildAccountUrl(url, nwsConnectionId) {
    url = url + "";

    // Подмена хоста на текущий балансер
    var currentHost = getBalancerUrl();
    for (var i = 0; i < BALANCER_SERVERS.length; i++) {
      if (url.indexOf(BALANCER_SERVERS[i]) !== -1) {
        url = url.replace(BALANCER_SERVERS[i], currentHost);
        break;
      }
    }

    var params = [];

    var email = getAccountEmail();
    if (email && url.indexOf("account_email=") === -1) {
      params.push("account_email=" + encodeURIComponent(email));
    }

    var uid = getUnicId();
    if (url.indexOf("uid=") === -1) {
      params.push("uid=" + encodeURIComponent(uid));
    }

    if (nwsConnectionId && url.indexOf("nws_id=") === -1) {
      params.push("nws_id=" + encodeURIComponent(nwsConnectionId));
    }

    if (params.length > 0) {
      url += (url.indexOf("?") >= 0 ? "&" : "?") + params.join("&");
    }

    return url;
  }

  // ============================================================
  // ОСНОВНОЙ КОМПОНЕНТ
  // ============================================================

  function LampacComponent(object) {
    var network = new Lampa.Reguest();
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);

    var sources = {};
    var currentSource;
    var currentBalancer;
    var filterSources = [];
    var filterFind = { season: [], voice: [] };
    var balancersWithSearch = [];
    var memkey;
    var sourceLoaded = false;

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

      filter.onBack = function () {
        self.start();
      };

      filter
        .render()
        .find(".filter--search")
        .appendTo(filter.render().find(".torrent-filter"));

      filter.onSelect = function (type, a, b) {
        if (type === "filter") {
          if (a.reset) {
            self.replaceChoice({
              season: 0,
              voice: 0,
              voice_url: "",
              voice_name: "",
            });
            setTimeout(function () {
              Lampa.Select.close();
              Lampa.Activity.replace({ clarification: 0, similar: 0 });
            }, 10);
          } else {
            var url = filterFind[a.stype][b.index].url;
            var choice = self.getChoice();
            if (a.stype === "voice") {
              choice.voice_name = filterFind.voice[b.index].title;
              choice.voice_url = url;
            }
            choice[a.stype] = b.index;
            self.saveChoice(choice);
            self.reset();
            self.request(url);
            setTimeout(Lampa.Select.close, 10);
          }
        } else if (type === "sort") {
          Lampa.Select.close();
          self.changeBalancer(a.source);
        }
      };

      if (filter.addButtonBack) filter.addButtonBack();
      filter
        .render()
        .find(".filter--sort span")
        .text(Lampa.Lang.translate("lampac_balanser"));

      scroll.body().addClass("torrent-list");
      files.appendFiles(scroll.render());
      files.appendHead(filter.render());
      scroll.minus(files.render().find(".explorer__files-head"));
      scroll.body().append(Lampa.Template.get("lampac_content_loading"));
      Lampa.Controller.enable("content");
      self.loading(false);

      if (object.balanser) {
        files.render().find(".filter--search").remove();
        sources = {};
        sources[object.balanser] = { name: object.balanser };
        currentBalancer = object.balanser;
        filterSources = [];
        return network.native(
          buildAccountUrl(object.url.replace("rjson=", "nojson=")),
          self.parse.bind(self),
          function () {
            files.render().find(".torrent-filter").remove();
            self.empty();
          },
          false,
          { dataType: "text" },
        );
      }

      self
        .externalIds()
        .then(function () {
          return self.createSource();
        })
        .then(function () {
          sourceLoaded = true;
          if (
            !balancersWithSearch.find(function (b) {
              return currentBalancer.slice(0, b.length) === b;
            })
          ) {
            filter.render().find(".filter--search").addClass("hide");
          }
          self.search();
        })
        .catch(function (e) {
          self.noConnectToServer(e);
        });
    };

    // ============================================================
    // ВНЕШНИЕ ID (IMDB, Kinopoisk, TMDB)
    // ============================================================

    this.externalIds = function () {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (object.movie.imdb_id && object.movie.kinopoisk_id) {
          resolve();
          return;
        }

        var query = [
          "id=" + encodeURIComponent(object.movie.id),
          "serial=" + (object.movie.name ? 1 : 0),
        ];
        if (object.movie.imdb_id)
          query.push("imdb_id=" + (object.movie.imdb_id || ""));
        if (object.movie.kinopoisk_id)
          query.push("kinopoisk_id=" + (object.movie.kinopoisk_id || ""));
        if (object.movie.tmdb_id)
          query.push("tmdb_id=" + (object.movie.tmdb_id || ""));

        var url = buildAccountUrl(
          getBalancerUrl() + "/externalids?" + query.join("&"),
        );
        network.timeout(10000);
        network.silent(
          url,
          function (json) {
            if (json) {
              for (var name in json) {
                object.movie[name] = json[name];
              }
            }
            resolve();
          },
          function () {
            resolve();
          },
        );
      });
    };

    // ============================================================
    // СОЗДАНИЕ ИСТОЧНИКА (LAMPAC EVENTS)
    // ============================================================

    this.createSource = function () {
      var self = this;
      return new Promise(function (resolve, reject) {
        var url = self.requestParams(
          getBalancerUrl() + "/lite/events?life=true",
        );
        network.timeout(15000);
        network.silent(
          buildAccountUrl(url),
          function (json) {
            if (!json) {
              reject();
              return;
            }
            if (json.accsdb) {
              reject(json);
              return;
            }

            if (json.life) {
              memkey = json.memkey;
              if (json.title) {
                if (object.movie.name) object.movie.name = json.title;
                if (object.movie.title) object.movie.title = json.title;
              }
              filter
                .render()
                .find(".filter--sort")
                .append(
                  '<span class="lampac-balanser-loader" style="width: 1.2em; height: 1.2em; margin-top: 0; ' +
                    'background: url(./img/loader.svg) no-repeat 50% 50%; background-size: contain; margin-left: 0.5em"></span>',
                );
              self
                .lifeSource()
                .then(self.startSource.bind(self))
                .then(resolve)
                .catch(reject);
            } else {
              self.startSource(json).then(resolve).catch(reject);
            }
          },
          reject,
        );
      });
    };

    // ============================================================
    // LIFE SOURCE (ОЖИДАНИЕ ПОЯВЛЕНИЯ ИСТОЧНИКОВ)
    // ============================================================

    this.lifeSource = function () {
      var self = this;
      return new Promise(function (resolve, reject) {
        var lifeUrl = self.requestParams(
          getBalancerUrl() + "/lifeevents?memkey=" + (memkey || ""),
        );
        var resolved = false;
        var waitTimes = 0;

        function poll() {
          network.timeout(3000);
          network.silent(
            buildAccountUrl(lifeUrl),
            function (json) {
              waitTimes++;
              if (!json || !json.online) {
                reject();
                return;
              }

              filterSources = [];
              sources = {};
              json.online.forEach(function (j) {
                var name = balancerName(j);
                sources[name] = {
                  url: j.url,
                  name: j.name,
                  show: typeof j.show === "undefined" ? true : j.show,
                };
              });
              filterSources = Object.keys(sources);

              var lastBalancer = self.getLastChoiceBalancer();
              filter.set(
                "sort",
                filterSources.map(function (e) {
                  return {
                    title: sources[e].name,
                    source: e,
                    selected: e === lastBalancer,
                    ghost: !sources[e].show,
                  };
                }),
              );
              filter.chosen("sort", [
                sources[lastBalancer]
                  ? sources[lastBalancer].name
                  : lastBalancer,
              ]);

              if (
                !resolved &&
                sources[lastBalancer] &&
                sources[lastBalancer].show
              ) {
                resolved = true;
                resolve(
                  json.online.filter(function (c) {
                    return c.show;
                  }),
                );
              } else if (waitTimes > 15 || json.ready) {
                filter.render().find(".lampac-balanser-loader").remove();
                if (!resolved) {
                  resolved = true;
                  resolve(
                    json.online.filter(function (c) {
                      return c.show;
                    }),
                  );
                }
              } else if (!resolved) {
                setTimeout(poll, 1000);
              }
            },
            function () {
              waitTimes++;
              if (waitTimes > 15) {
                reject();
              } else if (!resolved) {
                setTimeout(poll, 1000);
              }
            },
          );
        }

        poll();
      });
    };

    // ============================================================
    // ЗАПУСК ИСТОЧНИКА
    // ============================================================

    this.startSource = function (json) {
      var self = this;
      return new Promise(function (resolve, reject) {
        json.forEach(function (j) {
          var name = balancerName(j);
          sources[name] = {
            url: j.url,
            name: j.name,
            show: typeof j.show === "undefined" ? true : j.show,
          };
        });

        filterSources = Object.keys(sources);
        if (filterSources.length === 0) {
          reject();
          return;
        }

        var lastBalancer = self.getLastChoiceBalancer();
        currentBalancer = lastBalancer;
        if (!sources[currentBalancer]) currentBalancer = filterSources[0];
        if (!sources[currentBalancer].show && !object.lampac_custom_select) {
          currentBalancer = filterSources[0];
        }
        currentSource = sources[currentBalancer].url;
        Lampa.Storage.set("active_balanser", currentBalancer);

        resolve(json);
      });
    };

    // ============================================================
    // ПОИСК
    // ============================================================

    this.search = function () {
      this.filter({ source: filterSources }, this.getChoice());
      this.find();
    };

    this.find = function () {
      this.request(this.requestParams(currentSource));
    };

    this.request = function (url) {
      network.native(
        buildAccountUrl(url),
        this.parse.bind(this),
        this.doesNotAnswer.bind(this),
        false,
        { dataType: "text" },
      );
    };

    // ============================================================
    // ПАРСИНГ ОТВЕТА
    // ============================================================

    this.parse = function (str) {
      var json = {};
      try {
        json = JSON.parse(str);
      } catch (e) {
        json = {};
      }
      if (json && json.rch) return this.rch(json);

      try {
        var items = this.parseJsonDate(str, ".videos__item");
        var buttons = this.parseJsonDate(str, ".videos__button");

        if (
          items.length === 1 &&
          items[0].method === "link" &&
          !items[0].similar
        ) {
          filterFind.season = items.map(function (s) {
            return { title: s.text, url: s.url };
          });
          this.replaceChoice({ season: 0 });
          this.request(items[0].url);
        } else {
          this.activity.loader(false);
          var videos = items.filter(function (v) {
            return v.method === "play" || v.method === "call";
          });
          var similar = items.filter(function (v) {
            return v.similar;
          });

          if (videos.length) {
            if (buttons.length) {
              filterFind.voice = buttons.map(function (b) {
                return { title: b.text, url: b.url };
              });
              var choice = this.getChoice(currentBalancer);
              var findActive = buttons.find(function (v) {
                return v.active;
              });

              if (findActive) {
                this.replaceChoice({
                  voice: buttons.indexOf(findActive),
                  voice_name: findActive.text,
                });
              }
              this.display(videos);
            } else {
              this.replaceChoice({ voice: 0, voice_url: "", voice_name: "" });
              this.display(videos);
            }
          } else if (items.length) {
            if (similar.length) {
              this.similars(similar);
              this.activity.loader(false);
            } else {
              filterFind.season = items.map(function (s) {
                return { title: s.text, url: s.url };
              });
              var choice = this.getChoice(currentBalancer);
              var season = filterFind.season[choice.season];
              if (!season) season = filterFind.season[0];
              this.request(season.url);
            }
          } else {
            this.doesNotAnswer(json);
          }
        }
      } catch (e) {
        this.doesNotAnswer(e);
      }
    };

    this.parseJsonDate = function (str, name) {
      try {
        var html = $("<div>" + str + "</div>");
        var elems = [];
        html.find(name).each(function () {
          var item = $(this);
          var data = JSON.parse(item.attr("data-json") || "{}");
          var season = item.attr("s");
          var episode = item.attr("e");
          var text = item.text();

          if (!object.movie.name) {
            if (text.match(/\d+p/i)) {
              if (!data.quality) {
                data.quality = {};
                data.quality[text] = data.url;
              }
              text = object.movie.title;
            }
            if (text === "По умолчанию") {
              text = object.movie.title;
            }
          }
          if (episode) data.episode = parseInt(episode);
          if (season) data.season = parseInt(season);
          if (text) data.text = text;
          data.active = item.hasClass("active");
          elems.push(data);
        });
        return elems;
      } catch (e) {
        return [];
      }
    };

    // ============================================================
    // RCH (Remote Call Handler) через WebSocket
    // ============================================================

    this.rch = function (json, noreset) {
      var self = this;
      rchRun(json, function () {
        if (!noreset) self.find();
        else noreset();
      });
    };

    // ============================================================
    // ОТОБРАЖЕНИЕ ВИДЕО
    // ============================================================

    this.display = function (videos) {
      var self = this;
      this.draw(videos, {
        onEnter: function (item, html) {
          self.getFileUrl(
            item,
            function (json, jsonCall) {
              if (json && json.url) {
                var playlist = [];
                var first = self.toPlayElement(item);
                first.url = json.url;
                first.headers = jsonCall.headers || json.headers;
                first.quality = jsonCall.quality || item.qualitys;
                first.segments = jsonCall.segments || item.segments;
                first.subtitles = json.subtitles;
                first.hls_manifest_timeout =
                  jsonCall.hls_manifest_timeout || json.hls_manifest_timeout;

                if (json.vast && json.vast.url) {
                  first.vast_url = json.vast.url;
                  first.vast_msg = json.vast.msg;
                }

                self.orUrlReserve(first);
                self.setDefaultQuality(first);

                if (item.season) {
                  videos.forEach(function (elem) {
                    var cell = self.toPlayElement(elem);
                    if (elem === item) {
                      cell.url = json.url;
                    } else {
                      if (elem.method === "call") {
                        cell.url = function (call) {
                          self.getFileUrl(
                            elem,
                            function (stream) {
                              cell.url = stream.url || "";
                              call();
                            },
                            function () {
                              cell.url = "";
                              call();
                            },
                          );
                        };
                      } else {
                        cell.url = elem.url;
                      }
                    }
                    self.orUrlReserve(cell);
                    self.setDefaultQuality(cell);
                    playlist.push(cell);
                  });
                  if (playlist.length > 1) first.playlist = playlist;
                } else {
                  playlist.push(first);
                }

                if (first.url) {
                  first.isonline = true;
                  Lampa.Player.play(first);
                  if (playlist.length > 1) Lampa.Player.playlist(playlist);
                  item.mark();
                  self.updateBalancer(currentBalancer);
                } else {
                  Lampa.Noty.show(Lampa.Lang.translate("lampac_nolink"));
                }
              } else {
                Lampa.Noty.show(Lampa.Lang.translate("lampac_nolink"));
              }
            },
            true,
          );
        },
        onContextMenu: function (item, html, data, call) {
          self.getFileUrl(
            item,
            function (stream) {
              call({
                file: stream.url,
                quality: item.qualitys,
              });
            },
            true,
          );
        },
      });

      this.filter(
        {
          season: filterFind.season.map(function (s) {
            return s.title;
          }),
          voice: filterFind.voice.map(function (b) {
            return b.title;
          }),
        },
        this.getChoice(),
      );
    };

    // ============================================================
    // ПОЛУЧЕНИЕ URL ФАЙЛА
    // ============================================================

    this.getFileUrl = function (file, call, waitingRch) {
      var self = this;

      if (
        Lampa.Storage.field("player") !== "inner" &&
        file.stream &&
        Lampa.Platform.is("apple")
      ) {
        var newFile = Lampa.Arrays.clone(file);
        newFile.method = "play";
        newFile.url = file.stream;
        call(newFile, {});
      } else if (file.method === "play") {
        call(file, {});
      } else {
        Lampa.Loading.start(function () {
          Lampa.Loading.stop();
          Lampa.Controller.toggle("content");
          network.clear();
        });

        network.native(
          buildAccountUrl(file.url),
          function (json) {
            if (json && json.rch) {
              if (waitingRch) {
                Lampa.Loading.stop();
                call(false, {});
              } else {
                self.rch(json, function () {
                  Lampa.Loading.stop();
                  self.getFileUrl(file, call, true);
                });
              }
            } else {
              Lampa.Loading.stop();
              call(json, json);
            }
          },
          function () {
            Lampa.Loading.stop();
            call(false, {});
          },
        );
      }
    };

    // ============================================================
    // ПРЕОБРАЗОВАНИЕ В ЭЛЕМЕНТ ПЛЕЕРА
    // ============================================================

    this.toPlayElement = function (file) {
      return {
        title: file.title,
        url: file.url,
        quality: file.qualitys,
        timeline: file.timeline,
        subtitles: file.subtitles,
        segments: file.segments,
        callback: file.mark,
        season: file.season,
        episode: file.episode,
        voice_name: file.voice_name,
      };
    };

    this.orUrlReserve = function (data) {
      if (
        data.url &&
        typeof data.url === "string" &&
        data.url.indexOf(" or ") !== -1
      ) {
        var urls = data.url.split(" or ");
        data.url = urls[0];
        data.url_reserve = urls[1];
      }
    };

    this.setDefaultQuality = function (data) {
      if (data.quality && Object.keys(data.quality).length) {
        var defaultQuality = Lampa.Storage.field("video_quality_default");
        for (var q in data.quality) {
          if (parseInt(q) === defaultQuality) {
            data.url = data.quality[q];
            this.orUrlReserve(data);
          }
          if (data.quality[q] && data.quality[q].indexOf(" or ") !== -1) {
            data.quality[q] = data.quality[q].split(" or ")[0];
          }
        }
      }
    };

    // ============================================================
    // УПРАВЛЕНИЕ БАЛАНСЕРОМ
    // ============================================================

    this.updateBalancer = function (name) {
      var last = Lampa.Storage.cache("lampac_last_balancer", 3000, {});
      last[object.movie.id] = name;
      Lampa.Storage.set("lampac_last_balancer", last);
    };

    this.changeBalancer = function (name) {
      this.updateBalancer(name);
      Lampa.Storage.set("lampac_balancer", name);
      var to = this.getChoice(name);
      var from = this.getChoice();
      if (from.voice_name) to.voice_name = from.voice_name;
      this.saveChoice(to, name);
      Lampa.Activity.replace();
    };

    this.getLastChoiceBalancer = function () {
      var last = Lampa.Storage.cache("lampac_last_balancer", 3000, {});
      if (last[object.movie.id]) return last[object.movie.id];
      return Lampa.Storage.get(
        "lampac_balancer",
        filterSources.length ? filterSources[0] : "",
      );
    };

    // ============================================================
    // ПАРАМЕТРЫ ЗАПРОСА
    // ============================================================

    this.requestParams = function (url) {
      var query = [];
      var cardSource = object.movie.source || "tmdb";

      query.push("id=" + encodeURIComponent(object.movie.id));
      if (object.movie.imdb_id)
        query.push("imdb_id=" + encodeURIComponent(object.movie.imdb_id));
      if (object.movie.kinopoisk_id)
        query.push(
          "kinopoisk_id=" + encodeURIComponent(object.movie.kinopoisk_id),
        );
      if (object.movie.tmdb_id)
        query.push("tmdb_id=" + encodeURIComponent(object.movie.tmdb_id));
      query.push(
        "title=" +
          encodeURIComponent(
            object.clarification
              ? object.search
              : object.movie.title || object.movie.name,
          ),
      );
      query.push(
        "original_title=" +
          encodeURIComponent(
            object.movie.original_title || object.movie.original_name,
          ),
      );
      query.push("serial=" + (object.movie.name ? 1 : 0));
      query.push("original_language=" + (object.movie.original_language || ""));
      query.push(
        "year=" +
          (
            (object.movie.release_date ||
              object.movie.first_air_date ||
              "0000") + ""
          ).slice(0, 4),
      );
      query.push("source=" + cardSource);
      query.push("clarification=" + (object.clarification ? 1 : 0));
      query.push("similar=" + (object.similar ? true : false));

      var rchType = "";
      if (window.lampac_nws && window.lampac_nws[HOST_KEY]) {
        rchType = window.lampac_nws[HOST_KEY].type;
      }
      query.push("rchtype=" + (rchType || ""));

      var email = getAccountEmail();
      if (email) {
        query.push("cub_id=" + Lampa.Utils.hash(email));
      }

      return url + (url.indexOf("?") >= 0 ? "&" : "?") + query.join("&");
    };

    // ============================================================
    // ПОХОЖИЕ ФИЛЬМЫ
    // ============================================================

    this.similars = function (items) {
      var self = this;
      scroll.clear();
      items.forEach(function (elem) {
        elem.title = elem.text;
        elem.info = "";
        var info = [];
        var year = (
          (elem.start_date ||
            elem.year ||
            object.movie.release_date ||
            object.movie.first_air_date ||
            "") + ""
        ).slice(0, 4);
        if (year) info.push(year);
        if (elem.details) info.push(elem.details);
        elem.info = info.join('<span class="online-prestige-split">●</span>');
        elem.time = elem.time || "";

        var item = Lampa.Template.get("lampac_prestige_folder", elem);
        if (elem.img) {
          var image = $(
            '<img style="height: 7em; width: 7em; border-radius: 0.3em;"/>',
          );
          item.find(".online-prestige__folder").empty().append(image);
          var imgUrl = elem.img;
          if (imgUrl.charAt(0) === "/")
            imgUrl = getBalancerUrl() + imgUrl.substring(1);
          if (imgUrl.indexOf("/proxyimg") !== -1)
            imgUrl = buildAccountUrl(imgUrl);
          Lampa.Utils.imgLoad(image, imgUrl);
        }
        item.on("hover:enter", function () {
          self.reset();
          Lampa.Activity.replace({
            url: "",
            title: elem.title || elem.text,
            component: "lampac",
            movie: object.movie,
            search: elem.text,
            page: 1,
            clarification: true,
          });
        });
        scroll.append(item);
      });
    };

    // ============================================================
    // ОТРИСОВКА ВИДЕО
    // ============================================================

    this.draw = function (videos, events) {
      var self = this;
      scroll.clear();
      videos.forEach(function (elem) {
        elem.title = elem.text;
        elem.info = "";
        var info = [];
        if (elem.episode)
          info.push(
            elem.episode + " " + Lampa.Lang.translate("torrent_serial_episode"),
          );
        if (elem.quality) info.push(elem.quality);
        if (elem.details) info.push(elem.details);
        elem.info = info.join('<span class="online-prestige-split">●</span>');
        elem.time = "";
        if (elem.duration) elem.time = elem.duration;

        var template = elem.similar
          ? "lampac_prestige_folder"
          : "lampac_prestige_full";
        var item = Lampa.Template.get(template, elem);
        if (elem.poster) {
          var image = item.find("img");
          Lampa.Utils.imgLoad(image, elem.poster);
        }
        item.on("hover:enter", function () {
          if (events.onEnter) events.onEnter(elem, item);
        });
        item.on("contextMenu", function (e) {
          if (events.onContextMenu)
            events.onContextMenu(elem, item, e, function (data) {
              Lampa.Select.show({
                title: Lampa.Lang.translate("lampac_video"),
                items: [
                  {
                    title: elem.title,
                    url: data.file,
                    quality: data.quality,
                  },
                ],
                onSelect: function (b) {
                  Lampa.Player.play({
                    url: b.url,
                    title: elem.title,
                    quality: data.quality,
                  });
                },
              });
            });
        });
        scroll.append(item);
      });
    };

    // ============================================================
    // ФИЛЬТРЫ И ВЫБОР
    // ============================================================

    this.filter = function (filters, choice) {
      if (filters.source) {
        filter.set(
          "sort",
          filters.source.map(function (e) {
            return {
              title: sources[e].name,
              source: e,
              selected: e === currentBalancer,
              ghost: !sources[e].show,
            };
          }),
        );
        filter.chosen("sort", [
          sources[currentBalancer]
            ? sources[currentBalancer].name
            : currentBalancer,
        ]);
      }
      if (filters.season) {
        filter.set(
          "filter",
          filters.season.map(function (s, i) {
            return {
              title: s,
              stype: "season",
              index: i,
              selected: i === choice.season,
            };
          }),
        );
      }
      if (filters.voice) {
        filter.set(
          "filter",
          filters.voice.map(function (v, i) {
            return {
              title: v,
              stype: "voice",
              index: i,
              selected: i === choice.voice,
            };
          }),
        );
      }
    };

    this.getChoice = function (balancer) {
      balancer = balancer || currentBalancer;
      return Lampa.Storage.get("lampac_choice_" + balancer, {
        season: 0,
        voice: 0,
        voice_url: "",
        voice_name: "",
      });
    };

    this.saveChoice = function (choice, balancer) {
      balancer = balancer || currentBalancer;
      Lampa.Storage.set("lampac_choice_" + balancer, choice);
    };

    this.replaceChoice = function (choice) {
      var current = this.getChoice(currentBalancer);
      for (var key in choice) {
        current[key] = choice[key];
      }
      this.saveChoice(current, currentBalancer);
    };

    this.loading = function (state) {
      this.activity.loader(state);
    };

    this.reset = function () {
      scroll.clear();
    };

    this.empty = function () {
      resetTemplates();
      scroll.clear();
      scroll.append(
        Lampa.Template.get("lampac_does_not_answer", {
          balanser: sources[currentBalancer]
            ? sources[currentBalancer].name
            : currentBalancer,
        }),
      );

      scroll
        .body()
        .find(".cancel")
        .on("hover:enter", function () {
          Lampa.Activity.back();
        });
      scroll
        .body()
        .find(".change")
        .on("hover:enter", function () {
          Lampa.Select.show({
            title: Lampa.Lang.translate("lampac_change_balancer"),
            items: filterSources.map(function (s) {
              return {
                title: sources[s].name,
                source: s,
                selected: s === currentBalancer,
              };
            }),
            onSelect: function (b) {
              self.changeBalancer(b.source);
            },
          });
        });
    };

    this.doesNotAnswer = function () {
      this.empty();
    };

    this.noConnectToServer = function (e) {
      scroll.clear();
      var msg = Lampa.Lang.translate("lampac_balancer_dont_work");
      if (e && e.accsdb) msg = "Доступ запрещён (accsdb)";
      scroll.append(
        '<div class="online-empty"><div class="online-empty__title">' +
          msg +
          "</div></div>",
      );
    };

    this.create = function () {
      this.initialize();
      return files.render();
    };
  }

  // ============================================================
  // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ КОМПОНЕНТА
  // ============================================================

  function balancerName(j) {
    var bals = j.balanser;
    var name = (j.name || "").split(" ")[0];
    return (bals || name).toLowerCase();
  }

  // ============================================================
  // РЕГИСТРАЦИЯ ПЛАГИНА
  // ============================================================

  // ============================================================
  // РЕГИСТРАЦИЯ МАНИФЕСТА (синхронно, до app ready)
  // ============================================================

  var manifest = {
    type: "video",
    version: "1.0.0",
    name: "Lampac Balancer",
    description:
      "Плагин для просмотра онлайн через Lampac-балансеры. Поддерживает все популярные CDN.",
    component: "lampac",
    icon:
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM9 8h2v8H9zm4 0h2v8h-2z"/>' +
      "</svg>",
    onContextMenu: function (object) {
      return {
        name: "Смотреть онлайн",
        description: "",
      };
    },
    onContextLauch: function (object) {
      Lampa.Component.add("lampac", LampacComponent);
      Lampa.Activity.push({
        url: "",
        title: "Онлайн",
        component: "lampac",
        search: object.title,
        search_one: object.title,
        search_two: object.original_title,
        movie: object,
        page: 1,
      });
    },
  };

  Lampa.Manifest.plugins = manifest;

  function startPlugin() {
    window.lampac_plugin_ready = true;

    // ============================================================
    // ЛОКАЛИЗАЦИЯ
    // ============================================================

    Lampa.Lang.add({
      lampac_watch: {
        ru: "Смотреть онлайн",
        en: "Watch online",
        uk: "Дивитися онлайн",
      },
      lampac_video: {
        ru: "Видео",
        en: "Video",
        uk: "Відео",
      },
      lampac_nolink: {
        ru: "Нет доступной ссылки для просмотра",
        en: "No available link for viewing",
        uk: "Немає доступного посилання для перегляду",
      },
      lampac_balanser: {
        ru: "Источник",
        en: "Source",
        uk: "Джерело",
      },
      lampac_change_balancer: {
        ru: "Изменить источник",
        en: "Change source",
        uk: "Змінити джерело",
      },
      lampac_balanser_dont_work: {
        ru: "Поиск на ({balanser}) не дал результатов",
        en: "Search on ({balanser}) did not return any results",
        uk: "Пошук на ({balanser}) не дав результатів",
      },
    });

    // ============================================================
    // НАСТРОЙКИ ПЛАГИНА
    // ============================================================

    Lampa.SettingsApi.addParam({
      component: "lampac",
      param: { type: "title" },
      field: { name: "Lampac Balancer v1.0.0" },
    });

    Lampa.SettingsApi.addParam({
      component: "lampac",
      param: {
        type: "select",
        name: "lampac_proxy_enabled",
        default: "auto",
      },
      field: {
        name: "CORS Proxy",
        description:
          "Использовать CORS Proxy для обхода ограничений (Cloudflare Workers, Deno, Render)",
      },
      variants: [
        { id: "auto", name: "Авто (рекомендуется)" },
        { id: "always", name: "Всегда использовать" },
        { id: "disabled", name: "Отключить" },
      ],
    });

    Lampa.SettingsApi.addParam({
      component: "lampac",
      param: {
        type: "select",
        name: "lampac_server",
        default: "auto",
      },
      field: {
        name: "Сервер балансера",
        description: "Выбор Lampac-сервера для поиска источников",
      },
      variants: [
        { id: "auto", name: "Авто (случайный)" },
        { id: "hdpoisk.ru:2053", name: "hdpoisk.ru:2053" },
        { id: "78.40.199.67:10630", name: "78.40.199.67:10630" },
        { id: "144.124.224.240:11175", name: "144.124.224.240:11175" },
      ],
      onChange: function (value) {
        if (value && value !== "auto") {
          setBalancerUrl("http://" + value);
        }
      },
    });

    Lampa.SettingsApi.addParam({
      component: "lampac",
      param: {
        type: "trigger",
        name: "lampac_proxy_other",
        default: false,
      },
      field: {
        name: "Свой CORS Proxy",
        description: "Использовать свой CORS Proxy сервер",
      },
    });

    Lampa.SettingsApi.addParam({
      component: "lampac",
      param: {
        type: "input",
        name: "lampac_proxy_other_url",
        default: "",
        placeholder: "https://your-proxy.workers.dev/",
      },
      field: {
        name: "URL своего CORS Proxy",
        description: "Например: https://cors.nb557.workers.dev/",
      },
    });

    // ============================================================
    // ТЕМПЛЕЙТЫ
    // ============================================================

    function resetTemplates() {
      Lampa.Template.add(
        "lampac_prestige_full",
        '<div class="online-prestige online-prestige--full selector">' +
          '<div class="online-prestige__img">' +
          '<img alt=""><div class="online-prestige__loader"></div>' +
          "</div>" +
          '<div class="online-prestige__body">' +
          '<div class="online-prestige__head">' +
          '<div class="online-prestige__title">{title}</div>' +
          '<div class="online-prestige__time">{time}</div>' +
          "</div>" +
          '<div class="online-prestige__timeline"></div>' +
          '<div class="online-prestige__footer">' +
          '<div class="online-prestige__info">{info}</div>' +
          '<div class="online-prestige__quality">{quality}</div>' +
          "</div></div></div>",
      );

      Lampa.Template.add(
        "lampac_content_loading",
        '<div class="online-empty">' +
          '<div class="broadcast__scan"><div></div></div>' +
          '<div class="online-empty__templates">' +
          '<div class="online-empty-template selector">' +
          '<div class="online-empty-template__ico"></div>' +
          '<div class="online-empty-template__body"></div></div>' +
          '<div class="online-empty-template">' +
          '<div class="online-empty-template__ico"></div>' +
          '<div class="online-empty-template__body"></div></div>' +
          '<div class="online-empty-template">' +
          '<div class="online-empty-template__ico"></div>' +
          '<div class="online-empty-template__body"></div></div></div></div>',
      );

      Lampa.Template.add(
        "lampac_does_not_answer",
        '<div class="online-empty">' +
          '<div class="online-empty__title">#{lampac_balanser_dont_work}</div>' +
          '<div class="online-empty__buttons">' +
          '<div class="online-empty__button selector cancel">#{cancel}</div>' +
          '<div class="online-empty__button selector change">#{lampac_change_balancer}</div>' +
          "</div></div>",
      );

      Lampa.Template.add(
        "lampac_prestige_folder",
        '<div class="online-prestige online-prestige--folder selector">' +
          '<div class="online-prestige__folder">' +
          '<svg viewBox="0 0 128 112" fill="none">' +
          '<rect y="20" width="128" height="92" rx="13" fill="white"></rect>' +
          '<path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"></path>' +
          '<rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"></rect>' +
          "</svg></div>" +
          '<div class="online-prestige__body">' +
          '<div class="online-prestige__head">' +
          '<div class="online-prestige__title">{title}</div>' +
          '<div class="online-prestige__time">{time}</div></div>' +
          '<div class="online-prestige__footer">' +
          '<div class="online-prestige__info">{info}</div>' +
          "</div></div></div>",
      );
    }

    // ============================================================
    // CSS СТИЛИ
    // ============================================================

    Lampa.Template.add(
      "lampac_css",
      "<style>" +
        ".online-prestige{position:relative;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:flex}" +
        ".online-prestige__body{padding:1.2em;line-height:1.3;flex-grow:1;position:relative}" +
        "@media screen and (max-width:480px){.online-prestige__body{padding:.8em 1.2em}}" +
        ".online-prestige__img{position:relative;width:13em;flex-shrink:0;min-height:8.2em}" +
        ".online-prestige__img>img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:.3em;opacity:0;transition:opacity .3s}" +
        ".online-prestige__img--loaded>img{opacity:1}" +
        "@media screen and (max-width:480px){.online-prestige__img{width:7em;min-height:6em}}" +
        ".online-prestige__folder{padding:1em;flex-shrink:0}" +
        ".online-prestige__folder>svg{width:4.4em !important;height:4.4em !important}" +
        ".online-prestige__head{display:flex;justify-content:space-between;margin-bottom:.5em}" +
        ".online-prestige__title{font-weight:600;font-size:1.1em}" +
        ".online-prestige__time{font-size:.85em;opacity:.6;flex-shrink:0}" +
        ".online-prestige__timeline{height:2px;background:rgba(255,255,255,0.1);border-radius:2px;margin:.5em 0;position:relative}" +
        ".online-prestige__footer{display:flex;justify-content:space-between;align-items:center;margin-top:.3em}" +
        ".online-prestige__info{font-size:.85em;opacity:.6}" +
        ".online-prestige__quality{font-size:.85em;color:var(--accent-color,#ff5722)}" +
        ".online-prestige-split{margin:0 .4em;opacity:.3}" +
        ".online-empty{text-align:center;padding:2em}" +
        ".online-empty__title{margin-bottom:1em;opacity:.7}" +
        ".online-empty__buttons{display:flex;gap:1em;justify-content:center}" +
        ".online-empty__button{padding:.5em 1.5em;border-radius:2em;background:rgba(255,255,255,0.1)}" +
        ".online-empty__button:hover{background:rgba(255,255,255,0.2)}" +
        ".broadcast__scan{display:flex;justify-content:center;margin-bottom:1.5em}" +
        ".broadcast__scan>div{width:2em;height:2em;border:2px solid rgba(255,255,255,0.2);border-top-color:var(--accent-color,#ff5722);border-radius:50%;animation:spin .8s linear infinite}" +
        "@keyframes spin{to{transform:rotate(360deg)}}" +
        "</style>",
    );

    $("body").append(Lampa.Template.get("lampac_css", {}, true));
    resetTemplates();

    // ============================================================
    // РЕГИСТРАЦИЯ КОМПОНЕНТА
    // ============================================================

    Lampa.Component.add("lampac", LampacComponent);

    // ============================================================
    // ДОБАВЛЕНИЕ КНОПКИ В КАРТОЧКУ ФИЛЬМА
    // ============================================================

    var button =
      '<div class="full-start__button selector view--online lampac--button" data-subtitle="Lampac Balancer v1.0.0">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 392.697 392.697" fill="currentColor">' +
      '<path d="M21.837,83.419l36.496,16.678L227.72,19.886c1.229-0.592,2.002-1.846,1.98-3.209c-0.021-1.365-0.834-2.592-2.082-3.145L197.766,0.3c-0.903-0.4-1.933-0.4-2.837,0L21.873,77.036c-1.259,0.559-2.073,1.803-2.081,3.18C19.784,81.593,20.584,82.847,21.837,83.419z"/>' +
      '<path d="M185.689,177.261l-64.988-30.01v91.617c0,0.856-0.44,1.655-1.167,2.114c-0.406,0.257-0.869,0.386-1.333,0.386c-0.368,0-0.736-0.082-1.079-0.244l-68.874-32.625c-0.869-0.416-1.421-1.293-1.421-2.256v-92.229L6.804,95.5c-1.083-0.496-2.344-0.406-3.347,0.238c-1.002,0.645-1.608,1.754-1.608,2.944v208.744c0,1.371,0.799,2.615,2.045,3.185l178.886,81.768c0.464,0.211,0.96,0.315,1.455,0.315c0.661,0,1.318-0.188,1.892-0.555c1.002-0.645,1.608-1.754,1.608-2.945V180.445C187.735,179.076,186.936,177.831,185.689,177.261z"/>' +
      '<path d="M389.24,95.74c-1.002-0.644-2.264-0.732-3.347-0.238l-178.876,81.76c-1.246,0.57-2.045,1.814-2.045,3.185v208.751c0,1.191,0.606,2.302,1.608,2.945c0.572,0.367,1.23,0.555,1.892,0.555c0.495,0,0.991-0.104,1.455-0.315l178.876-81.768c1.246-0.568,2.045-1.813,2.045-3.185V98.685C390.849,97.494,390.242,96.384,389.24,95.74z"/>' +
      '<path d="M372.915,80.216c-0.009-1.377-0.823-2.621-2.082-3.18l-60.182-26.681c-0.938-0.418-2.013-0.399-2.938,0.045l-173.755,82.992l60.933,29.117c0.462,0.211,0.958,0.316,1.455,0.316s0.993-0.105,1.455-0.316l173.066-79.092C372.122,82.847,372.923,81.593,372.915,80.216z"/>' +
      "</svg><span>#{lampac_watch} ...</span></div>";

    function addButton(e) {
      if (e.render.find(".lampac--button").length) return;
      var btn = $(Lampa.Lang.translate(button));
      btn.on("hover:enter", function () {
        Lampa.Component.add("lampac", LampacComponent);
        Lampa.Activity.push({
          url: "",
          title: Lampa.Lang.translate("title_online"),
          component: "lampac",
          search: e.movie.title,
          search_one: e.movie.title,
          search_two: e.movie.original_title,
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
          render: Lampa.Activity.active()
            .activity.render()
            .find(".view--torrent"),
          movie: Lampa.Activity.active().card,
        });
      }
    } catch (e) {}
  }

  // ============================================================
  // ЗАПУСК
  // ============================================================

  if (window.appready) {
    startPlugin();
  } else {
    Lampa.Listener.follow("app", function (e) {
      if (e.type === "ready") startPlugin();
    });
  }
})();
