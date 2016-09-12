define(function (require) {
  const _ = require('lodash');
  const $ = require('jquery');
  const angular = require('angular');
  const ConfigTemplate = require('ui/ConfigTemplate');
  const chrome = require('ui/chrome');

  require('ui/directives/config');
  require('ui/courier');
  require('ui/config');
  require('ui/notify');
  require('ui/typeahead');
  require('ui/share');

  require('plugins/kibana/dashboard/directives/grid');
  require('plugins/kibana/dashboard/components/panel/panel');
  require('plugins/kibana/dashboard/services/saved_dashboards');
  require('plugins/kibana/dashboard/styles/main.less');

  require('ui/saved_objects/saved_object_registry').register(require('plugins/kibana/dashboard/services/saved_dashboard_register'));


  const app = require('ui/modules').get('app/dashboard', [
    'elasticsearch',
    'ngRoute',
    'kibana/courier',
    'kibana/config',
    'kibana/notify',
    'kibana/typeahead'
  ]);

  require('ui/routes')
  .when('/dashboard', {
    template: require('plugins/kibana/dashboard/index.html'),
    resolve: {
      dash: function (savedDashboards, config) {
        return savedDashboards.get();
      }
    }
  })
  .when('/dashboard/:id', {
    template: require('plugins/kibana/dashboard/index.html'),
    resolve: {
      dash: function (savedDashboards, Notifier, $route, $location, courier) {
        return savedDashboards.get($route.current.params.id)
        .catch(courier.redirectWhenMissing({
          'dashboard' : '/dashboard'
        }));
      }
    }
  });

  app.directive('dashboardApp', function (Notifier, courier, AppState, timefilter, kbnUrl) {
    return {
      controller: function ($scope, $http, $rootScope, $route, $routeParams, $location, Private, getAppState) {

        // Make request to obtain channels
         $http({
            method: 'GET',
            url: 'http://dashboard.dev/api/channels',
            withCredentials: true
          }).then(function successCallback(response) {
              data = response.data.channels.push({"id":"-1","title":"Everything","description":"test","arguments":[]});
              $scope.channels = {
                model: window.selectedChannel,
                availableOptions: response.data.channels
               };

          }, function errorCallback(response) {
              notify.warning("There was an error obtaining information from the backend! [channel selector component]");
          });

        // On selector change, update rules
        $scope.findRules = function(id) {
          window.selectedChannel = id;
          if(id != "-1"){
            $http({
               method: 'GET',
               url: 'http://dashboard.dev/api/arguments',
               params: {channel_id: id},
               withCredentials: true
             }).then(function successCallback(response) {
                  $scope.customQuery(response.data.arguments)

             }, function errorCallback(response) {
                  notify.warning("There was an error obtaining information from the backend! [channel selector component]");
             });
           }
           else{
             window.scope = $scope;
             $scope.queryShoulds = [];
             $scope.queryMusts = [];
           }
        };


        $scope.customQuery = function (argDetails) {
          var queryShoulds = [];
          var termQueries, termQuery;
          var newQuery;

          argDetails.forEach(function (value) {
            newQuery = { bool: { must: [], should: [], must_not: [], minimum_should_match: 1 } }
            newQuery['bool']['must'] = $scope.build_bool_query(value.must);
            newQuery['bool']['should'] = $scope.build_bool_query(value.should);
            newQuery['bool']['must_not'] = $scope.build_bool_query(value.dont);

            termQueries = [];
            ['forum_id', 'facebook_id'].forEach(function(key) {
              termQuery = { "term": {}};
              if (value[key]) {
                termQuery["term"][key] = value[key];
                newQuery['bool']['must'] = newQuery['bool']['must'].concat(termQuery);
              }
            });

            if (value['id'] == 9) { console.log(newQuery); }
            if (newQuery['bool']['must'].length > 0 || newQuery['bool']['should'] > 0 || newQuery['bool']['must_not'].length > 0) {
              queryShoulds.push(newQuery);
            }
          });
          $scope.queryShoulds = queryShoulds;
          window.scope = $scope;
        };

        $scope.build_bool_query = function (values) {
          var queries = [];
          values.forEach(function (value) {
            queries.push({ multi_match: {query: value, type: 'phrase', fields: ['title','content']}});
          });
          return queries
        }

        const queryFilter = Private(require('ui/filter_bar/query_filter'));

        const notify = new Notifier({
          location: 'Dashboard'
        });

        const dash = $scope.dash = $route.current.locals.dash;

        if (dash.timeRestore && dash.timeTo && dash.timeFrom && !getAppState.previouslyStored()) {
          timefilter.time.to = dash.timeTo;
          timefilter.time.from = dash.timeFrom;
        }

        $scope.$on('$destroy', dash.destroy);

        const matchQueryFilter = function (filter) {
          return filter.query && filter.query.query_string && !filter.meta;
        };

        const extractQueryFromFilters = function (filters) {
          const filter = _.find(filters, matchQueryFilter);
          if (filter) return filter.query;
        };

        const stateDefaults = {
          title: dash.title,
          panels: dash.panelsJSON ? JSON.parse(dash.panelsJSON) : [],
          options: dash.optionsJSON ? JSON.parse(dash.optionsJSON) : {},
          uiState: dash.uiStateJSON ? JSON.parse(dash.uiStateJSON) : {},
          query: extractQueryFromFilters(dash.searchSource.getOwn('filter')) || {query_string: {query: '*'}},
          filters: _.reject(dash.searchSource.getOwn('filter'), matchQueryFilter),
        };

        const $state = $scope.state = new AppState(stateDefaults);
        const $uiState = $scope.uiState = $state.makeStateful('uiState');

        $scope.$watchCollection('state.options', function (newVal, oldVal) {
          if (!angular.equals(newVal, oldVal)) $state.save();
        });
        $scope.$watch('state.options.darkTheme', setDarkTheme);

        $scope.configTemplate = new ConfigTemplate({
          save: require('plugins/kibana/dashboard/partials/save_dashboard.html'),
          load: require('plugins/kibana/dashboard/partials/load_dashboard.html'),
          share: require('plugins/kibana/dashboard/partials/share.html'),
          pickVis: require('plugins/kibana/dashboard/partials/pick_visualization.html'),
          options: require('plugins/kibana/dashboard/partials/options.html')
        });

        $scope.refresh = _.bindKey(courier, 'fetch');

        timefilter.enabled = true;
        $scope.timefilter = timefilter;
        $scope.$listen(timefilter, 'fetch', $scope.refresh);

        courier.setRootSearchSource(dash.searchSource);

        function init() {
          updateQueryOnRootSource();

          const docTitle = Private(require('ui/doc_title'));
          if (dash.id) {
            docTitle.change(dash.title);
          }

          initPanelIndices();
          $scope.$emit('application.load');
        }

        function initPanelIndices() {
          // find the largest panelIndex in all the panels
          let maxIndex = getMaxPanelIndex();

          // ensure that all panels have a panelIndex
          $scope.state.panels.forEach(function (panel) {
            if (!panel.panelIndex) {
              panel.panelIndex = maxIndex++;
            }
          });
        }

        function getMaxPanelIndex() {
          let index = $scope.state.panels.reduce(function (idx, panel) {
            // if panel is missing an index, add one and increment the index
            return Math.max(idx, panel.panelIndex || idx);
          }, 0);
          return ++index;
        }

        function updateQueryOnRootSource() {
          const filters = queryFilter.getFilters();
          if ($state.query) {
            dash.searchSource.set('filter', _.union(filters, [{
              query: $state.query
            }]));
          } else {
            dash.searchSource.set('filter', filters);
          }
        }

        function setDarkTheme(enabled) {
          const theme = Boolean(enabled) ? 'theme-dark' : 'theme-light';
          chrome.removeApplicationClass(['theme-dark', 'theme-light']);
          chrome.addApplicationClass(theme);
        }

        // update root source when filters update
        $scope.$listen(queryFilter, 'update', function () {
          updateQueryOnRootSource();
          $state.save();
        });

        // update data when filters fire fetch event
        $scope.$listen(queryFilter, 'fetch', $scope.refresh);

        $scope.newDashboard = function () {
          kbnUrl.change('/dashboard', {});
        };

        $scope.filterResults = function () {
          updateQueryOnRootSource();
          $state.save();
          $scope.refresh();
        };

        $scope.save = function () {
          $state.title = dash.id = dash.title;
          $state.save();

          dash.panelsJSON = angular.toJson($state.panels);
          dash.uiStateJSON = angular.toJson($uiState.getChanges());
          dash.timeFrom = dash.timeRestore ? timefilter.time.from : undefined;
          dash.timeTo = dash.timeRestore ? timefilter.time.to : undefined;
          dash.optionsJSON = angular.toJson($state.options);

          dash.save()
          .then(function (id) {
            $scope.configTemplate.close('save');
            if (id) {
              notify.info('Saved Dashboard as "' + dash.title + '"');
              if (dash.id !== $routeParams.id) {
                kbnUrl.change('/dashboard/{{id}}', {id: dash.id});
              }
            }
          })
          .catch(notify.fatal);
        };

        let pendingVis = _.size($state.panels);
        $scope.$on('ready:vis', function () {
          if (pendingVis) pendingVis--;
          if (pendingVis === 0) {
            $state.save();
            $scope.refresh();
          }
        });

        // listen for notifications from the grid component that changes have
        // been made, rather than watching the panels deeply
        $scope.$on('change:vis', function () {
          $state.save();
        });

        // called by the saved-object-finder when a user clicks a vis
        $scope.addVis = function (hit) {
          pendingVis++;
          $state.panels.push({ id: hit.id, type: 'visualization', panelIndex: getMaxPanelIndex() });
        };

        $scope.addSearch = function (hit) {
          pendingVis++;
          $state.panels.push({ id: hit.id, type: 'search', panelIndex: getMaxPanelIndex() });
        };

        // Setup configurable values for config directive, after objects are initialized
        $scope.opts = {
          dashboard: dash,
          ui: $state.options,
          save: $scope.save,
          addVis: $scope.addVis,
          addSearch: $scope.addSearch
        };

        init();
      }
    };
  });
});
