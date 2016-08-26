/*jshint laxbreak: true */
/*jshint laxcomma: true */

var _ = require("underscore");
var d3 = require("d3");

var Constants = require("./Constants");
var DataLoader = require("./DataLoader");
var CategoryFactory = require("./CategoryFactory");
var ViewerHelper = require("./ViewerHelper");
var FeatureFactory = require("./FeatureFactory");
var CategoryFilterDialog = require("./CategoryFilterDialog");
var ZoomToRegionFactory = require("./ZoomToRegionFactory");
var TooltipFactory = require('./TooltipFactory');
var ZoomingBehaviour = require('./ZoomingBehaviour');
var jQuery = require('jquery');

var closeTooltipAndPopup = function(fv) {
    if (!fv.overFeature && !fv.overTooltip) {
        var tooltipContainer = fv.globalContainer.selectAll('.up_pftv_tooltip-container')
            .transition(20)
            .style('opacity', 0)
            .style('display', 'none');
        tooltipContainer.remove();
    }
    if (!fv.overCatFilterDialog) {
        CategoryFilterDialog.closeDialog(fv);
    }
};

var createNavRuler = function(fv, container) {
    var navHeight = 40, navWithTrapezoid = 50;

    var navXScale = d3.scale.linear()
        .domain([1,fv.maxPos])
        .range([fv.padding.left, fv.width - fv.padding.right]);

    var svg = container
        .append('div')
        .attr('class', 'up_pftv_navruler')
        .append('svg')
        .attr('id','up_pftv_svg-navruler')
        .attr('width', fv.width)
        .attr('height', (navWithTrapezoid));

    var navXAxis = d3.svg.axis()
        .scale(fv.xScale)
        .orient('bottom');

    svg.append('g')
        .attr('class', 'x axis')
        .call(navXAxis);

    var viewport = d3.svg.brush()
        .x(navXScale)
        .on("brush", function() {
            var s = d3.event.target.extent();
            if((s[1] - s[0]) < fv.maxZoomSize) {
                d3.event.target.extent([s[0],s[0] + fv.maxZoomSize]);
                d3.event.target(d3.select(this));
            }
            fv.xScale.domain(viewport.empty() ? navXScale.domain() : viewport.extent());
            ZoomingBehaviour.update(fv);
            viewport.updateTrapezoid();
        });
    viewport.on("brushstart", function () {
        closeTooltipAndPopup(fv);
    });
    viewport.on("brushend", function () {
        ZoomingBehaviour.updateZoomFromChart(fv);
        var navigator = fv.globalContainer.select('.up_pftv_navruler .extent');
        if (+navigator.attr('width') >= fv.width - fv.padding.left - fv.padding.right) {
            ZoomingBehaviour.updateZoomButton(fv, 'fv-icon-zoom-out', 'fv-icon-zoom-in', 'Zoom in to sequence view');
        }
    });

    var arc = d3.svg.arc()
        .outerRadius(navHeight / 4)
        .startAngle(0)
        .endAngle(function(d, i) { return i ? -Math.PI : Math.PI; });

    svg.append("g")
        .attr("class", "up_pftv_viewport")
        .call(viewport)
        .selectAll("rect")
        .attr("height", navHeight);

    viewport.trapezoid = svg.append("g")
        .selectAll("path")
        .data([0]).enter().append("path")
        .classed("up_pftv_trapezoid", true);

    viewport.domainStartLabel = svg.append("text")
        .attr('class', 'domain-label')
        .attr('x',0)
        .attr('y',navHeight);

    viewport.domainEndLabel = svg.append("text")
        .attr('class', 'domain-label')
        .attr('x',fv.width)
        .attr('y',navHeight)
        .attr('text-anchor','end');

    svg.selectAll(".resize").append("path")
        .attr("transform", "translate(0," +  ((navHeight / 2) - 5) + ")")
        .attr('class','handle')
        .attr("d", arc);

    viewport.updateTrapezoid = function() {
        var begin = fv.globalContainer.select(".up_pftv_navruler .extent").attr("x");
        var tWidth = fv.globalContainer.select(".up_pftv_navruler .extent").attr("width");
        var end = (+begin) + (+tWidth);
        var path =  "M0," + (navWithTrapezoid) + "L0" + "," + (navWithTrapezoid-2)
            + "L" + begin + "," + (navHeight-12) + "L" + begin + "," + navHeight
            + "L" + end + "," + navHeight + "L" + end + "," + (navHeight-12)
            + "L" + fv.width + "," + (navWithTrapezoid-2) + "L" + fv.width + "," + (navWithTrapezoid) + "Z";
        this.trapezoid.attr("d", path);
        this.domainStartLabel.text(Math.round(fv.xScale.domain()[0]));
        this.domainEndLabel.text(Math.min(Math.round(fv.xScale.domain()[1]), fv.maxPos));
    };

    viewport.clearTrapezoid = function() {
        this.trapezoid.attr("d", "M0,0");
    };

    return viewport;
};

var createButtons = function(fv, data, container) {
    var buttons = container.append('div')
        .attr('class','up_pftv_buttons');
    buttons.append('span').append('a')
        .attr('class','fv-icon-info-circled')
        .attr('title','Help page')
        .attr('href', 'http://ebi-uniprot.github.io/ProtVista/')
        .attr('target', '_blank');
    buttons.append('span')
        .attr('class','fv-icon-cog')
        .attr('title','Hide/Show tracks')
        .on('click', function(){
            CategoryFilterDialog.displayDialog(fv, buttons);
        });
    buttons.append('span')
        .attr('class','fv-icon-arrows-cw')
        .attr('title','Reset view')
        .on('click', function(){
            ZoomingBehaviour.resetZoomAndSelection(fv);
        });
};

var createAAViewer = function(fv, container, sequence) {
    var aaViewer = {}, aaViewWidth = fv.width, aaViewHeight = 30;
    var svg = container
        .append('div')
        .attr('class','up_pftv_aaviewer')
        .append('svg')
        .attr('width', aaViewWidth)
        .attr('height',aaViewHeight);

    //amino acids selector
    var aaSelectorPlot = function(){
        var series, aminoAcids;
        var aaSelectorPlot = function(selection) {
            selection.each(function(data) {
                series = d3.select(this);
                aminoAcids = series.selectAll('.up_pftv_amino_acid_selector').data(data);
                aminoAcids.enter().append('path');
                aminoAcids
                    .attr('d', function(d) {
                        return ViewerHelper.highlightPath(d.feature, fv, aaViewHeight);
                    })
                    .attr('transform', function(d) {
                        return 'translate(' + fv.xScale(d.feature.begin) + ',0)';
                    })
                    .classed('up_pftv_amino_acid_selector', true);
                aminoAcids.exit().remove();
            });
        };
        return aaSelectorPlot;
    };

    var selectorSeries = aaSelectorPlot();
    var selectorGroup = svg.append('g')
        .attr('clip-path','url(#aaSelectorViewClip)')
        .style('opacity',1);
    selectorGroup.datum([{"feature": {"begin": -10, "end": -10}}])
        .call(selectorSeries);
    //scale
    var xAxis = d3.svg.axis()
        .scale(fv.xScale);
    var gAxis = svg.append("g")
                .attr("class", "x axis")
                .attr('transform','translate(0, -7)')
                .call(xAxis);
    //amino acids
    var aaPlot = function(){
        var series, aminoAcids;
        var aaPlot = function(selection) {
            selection.each(function(data) {
                series = d3.select(this);
                aminoAcids = series.selectAll('.up_pftv_amino-acid').data(data);
                aminoAcids.enter().append('text')
                    .style('text-anchor','middle')
                    .attr('y', aaViewHeight / 2)
                    .text(function(d) {
                        return d.toUpperCase();
                    })
                    .attr('title', function(d, i) {
                        return (i+1);
                    })
                    .attr('class','up_pftv_amino-acid');
                aminoAcids
                    .attr('x', function(d, i) {
                        return fv.xScale(i+1);
                    });
                aminoAcids.exit().remove();
            });
        };
        return aaPlot;
    };

    var series = aaPlot();

    var g = svg.append('g')
        .attr('class','up_pftv_aa-text')
        .attr('clip-path','url(#aaViewClip)')
        .attr('transform','translate(0,' + aaViewHeight/5 +  ')')
        .style('opacity',0);
    g.datum(sequence.split('')).call(series);

    aaViewer.update = function() {
        gAxis.call(xAxis);
        selectorGroup.call(selectorSeries);
        var count = fv.xScale.domain()[1] - fv.xScale.domain()[0];
        if (count > 70) {
            g.transition(50).style('opacity',0);
        } else {
            g.call(series);
            g.transition(50).style('opacity',1);
        }
    };

    aaViewer.updateFeatureHighlightSelector = function(begin, end) {
        selectorGroup.datum([{"feature": {"begin": begin, "end": end, "type": 'continuous'}}]).call(selectorSeries);
    };

    return aaViewer;
};

var findFeature = function(fv, ftType, begin, end, altSequence) {
    var lookup, varLookup;
    _.find(fv.data, function(category) {
        lookup =  _.find(category[1], function(feature) {
            var ftEnd = feature.end ? feature.end : feature.begin;
            if (feature.variants && (feature.type === 'VARIANT')) {
                varLookup = _.find(feature.variants, function(variant) {
                    var varEnd = variant.end ? variant.end : variant.begin;
                    return (+variant.begin === +begin) && (+varEnd === +end)
                        && (variant.alternativeSequence === altSequence);
                });
                return varLookup;
            } else if (feature.type === 'CONFLICT'){
                return (+feature.begin === +begin) && (+ftEnd === +end)
                    && (feature.alternativeSequence === altSequence);
            } else if (feature.type === 'MUTAGEN') {
                return (+feature.begin === +begin) && (+ftEnd === +end)
                    && (feature.alternativeSequence === altSequence);
            } else {
                return (feature.type === ftType) && (+feature.begin === +begin) && (+ftEnd === +end);
            }
        });
        return lookup;
    });
    return varLookup ? varLookup : lookup;
};

var initSources = function (opts) {
    if (opts.defaultSources === false) {
        Constants.clearDataSources();
    }
    _.each(opts.customDataSources, function(dataSource) {
        Constants.addSource(dataSource);
    });
};

var loadSources = function(opts, dataSources, loaders, delegates, fv) {
    fv.initLayout(opts);
    _.each(dataSources, function(source, index) {
        if (!_.contains(opts.exclusions, source.category)) {
            var url = source.url + opts.uniprotacc;
            url = source.useExtension === true ? url + '.json' : url;
            var dataLoader = DataLoader.get(url);
            loaders.push(dataLoader);
            dataLoader.done(function (d) {
                if (d instanceof Array) //Workaround to be removed
                    d = d[0];
                // First promise to resolve will set global parameters
                if (!fv.sequence) {
                    fv.loadZoom(d);
                }
                var features = d.features;
                // group by categories
                if (features.length > 0 && _.has(features[0], 'category')) {
                    features = DataLoader.groupFeaturesByCategory(features);
                    features = _.filter(features, function (cat) {
                        return !_.contains(opts.exclusions, cat[0]);
                    });
                } else if (features.length > 0 && features[0].type === 'VARIANT') {
                    if (_.contains(opts.exclusions, 'VARIATION')) {
                        features = [];
                    } else {
                        features = DataLoader.processVariants(features, d.sequence);
                    }
                } else if (features.length > 0 && features[0].type === 'PROTEOMICS') {
                    if (_.contains(opts.exclusions, 'PROTEOMICS')) {
                        features = [];
                    } else {
                        features = DataLoader.processProteomics(features);
                    }
                } else if (features.length > 0) {
                    features = DataLoader.processUngroupedFeatures(features);
                }
                if (features.length >= 0) {
                    fv.drawCategories(features, fv);
                    fv.data = fv.data.concat(features);
                    fv.dispatcher.ready();
                }
            }).fail(function (e) {
                console.log(e);
            }).always(function () {
                delegates[index].resolve();
            });
        } else {
            delegates[index].resolve();
        }
    });
};

var FeaturesViewer = function(opts) {
    var fv = this;
    fv.dispatcher = d3.dispatch("featureSelected", "featureDeselected", "ready", "noDataAvailable", "noDataRetrieved",
        "notFound", "notConfigRetrieved", "regionHighlighted");

    fv.width = 760;
    fv.maxZoomSize = 30;
    fv.selectedFeature = undefined;
    fv.selectedFeatureElement = undefined;
    fv.sequence = "";
    fv.categories = [];
    fv.filterCategories = [];
    fv.padding = {top:2, right:10, bottom:2, left:10};
    fv.data = [];

    fv.load = function() {
        initSources(opts);
        var dataSources = Constants.getDataSources();
        var loaders = [], delegates = [];
        _.each(dataSources, function (source) {
            var delegate = jQuery.Deferred();
            delegates.push(delegate);
        });

        if (opts.customConfig) {
            var configLoader = DataLoader.get(opts.customConfig);
            configLoader.done(function(d) {
                Constants.setCategoryNamesInOrder(d.categories);
                Constants.setTrackNames(d.trackNames);
                loadSources(opts, dataSources, loaders, delegates, fv);
            })
            .fail(function(e) {
                d3.select(opts.el).text('The configuration file provided by external sources could not be retrieved');
                fv.dispatcher.notConfigRetrieved({config: opts.customConfig});
                console.log(e);
            });
        } else {
            loadSources(opts, dataSources, loaders, delegates, fv);
        }

        jQuery.when.apply(null, delegates).done(function () {
            var rejected = _.filter(loaders, function (loader) {
                return loader.state() === 'rejected';
            });
            if ((rejected.length === loaders.length) || (fv.data.length === 0)) {
                d3.select(opts.el).selectAll('*').remove();
                d3.select(opts.el).html('');
                if (rejected.length === loaders.length) {
                    d3.select(opts.el).text('Sorry, data could not be retrieved at this time, please try again later.');
                    fv.dispatcher.noDataRetrieved();
                } else if (fv.data.length === 0) {
                    d3.select(opts.el).text('There are no features available for this protein.');
                    fv.dispatcher.noDataAvailable();
                }
            }
        });
    };

    fv.load();
};

FeaturesViewer.prototype.getCategoryTitle = function(type) {
    var fv = this;
    var category = _.find(fv.data, function(cat) {
        var hasType = _.find(cat[1], function(ft) {
            return ft.type === type;
        });
        return hasType;
    });
    return category ? category[0] : undefined;
};

FeaturesViewer.prototype.updateFeatureHighlightSelector = function(begin, end) {
    this.aaViewer.updateFeatureHighlightSelector(begin, end);
    this.aaViewer2.updateFeatureHighlightSelector(begin, end);
};

FeaturesViewer.prototype.getDispatcher = function() {
    return this.dispatcher;
};

FeaturesViewer.prototype.deselectFeature = function() {
    var fv = this;
    ViewerHelper.deselectFeature(fv);
};

FeaturesViewer.prototype.selectFeature = function(ftType, start, end, altSequence) {
    var fv = this;
    ftType = ftType.toUpperCase();
    altSequence = altSequence ? altSequence.toUpperCase() : altSequence;

    var catTitle = fv.getCategoryTitle(ftType);
    var category = _.find(fv.categories, function(cat) {
        return cat.name === catTitle;
    });

    var feature = findFeature(fv, ftType, +start, +end, altSequence);
    if (!feature) {
        fv.dispatcher.notFound({ftType: ftType, begin: start, end: end});
        return undefined;
    }

    var elem = fv.globalContainer.select('[name="' + feature.internalId + '"]');
    if (category && feature && elem && !elem.classed('up_pftv_variant_hidden')) {
        var container = category.viewerContainer.style('display') === 'none'
            ? category.tracksContainer : category.viewerContainer;
        if (elem.classed('up_pftv_variant')) {
            var varTrack = fv.globalContainer.select('.up_pftv_category-name[title="' + catTitle + '"]');
            if (varTrack.classed('up_pftv_arrow-right')) {
                category.toggle();
            }
        }
        var elemRect = elem.node().getBoundingClientRect();
        var contRect = container.node().getBoundingClientRect();
        var coordinates = {x: elemRect.x - contRect.x, y: elemRect.y - contRect.y};
        if (fv.selectedFeature) {
            if (fv.selectedFeature.internalId !== feature.internalId) {
                ViewerHelper.selectFeature(feature, elem.node(), fv);
            } else {
                fv.dispatcher.featureSelected({feature: fv.selectedFeature, color: elem.style("fill")});
            }
        } else {
            ViewerHelper.selectFeature(feature, elem.node(), fv);
        }
        TooltipFactory.createTooltip(fv, catTitle, feature, container, coordinates);
        return feature;
    } else {
        fv.dispatcher.notFound({ftType: ftType, begin: start, end: end});
        return undefined;
    }
};

FeaturesViewer.prototype.highlightRegion = function(begin, end) {
    var fv = this;
    begin = begin < 1 ? 1: begin;
    end = end
        ? end > fv.sequence.length ? fv.sequence.length : end
        : begin;
    if ((1 <= begin) && (begin <= end) && (end <= fv.sequence.length)) {
        fv.deselectFeature();
        fv.highlight = {begin: begin, end: end, type:'continuous'};
        if ((fv.xScale(fv.xScale.domain()[0]) > fv.xScale(begin)) ||
            (fv.xScale(end) > fv.xScale(fv.xScale.domain()[1]))) {
            ZoomingBehaviour.zoomOut(fv);
        }
        ViewerHelper.updateHighlight(fv);
        fv.dispatcher.regionHighlighted({begin: begin, end: end});
    }
};

FeaturesViewer.prototype.initLayout = function(opts, d) {
    var fv = this;
    //remove any previous text
    fv.globalContainer = d3.select(opts.el).text('');
    var fvContainer = fv.globalContainer
        .append('div')
        .attr('class', 'up_pftv_container')
        .on('mousedown', function() {
            closeTooltipAndPopup(fv);
        });

    fv.header = fvContainer.append('div');

    fv.container = fvContainer
        .append('div')
        .attr('class', 'up_pftv_category-container');

    fv.ontheFlyContainer = fv.container.append('div').classed('up_pftv_category_on_the_fly', true);

    _.each(Constants.getCategoryNamesInOrder(), function(catInfo) {
        fv.container.append('div').classed('up_pftv_category_' + catInfo.name, true);
    });

    fv.footer = fvContainer.append('div').attr('class','bottom-aa-container');
};

FeaturesViewer.prototype.loadZoom = function(d) {
  var fv = this;
  fv.sequence = d.sequence;
  fv.accession = d.accession;
  fv.maxPos = d.sequence.length;

  fv.xScale = d3.scale.linear()
      .domain([1, d.sequence.length + 1])
      .range([fv.padding.left, fv.width - fv.padding.right]);

  ZoomToRegionFactory.createZoomZone(fv, fv.header);
  fv.viewport = createNavRuler(fv, fv.header);
  createButtons(fv, d, fv.header);
  fv.aaViewer = createAAViewer(fv, fv.header, d.sequence);

  fv.zoom = ZoomingBehaviour.createZoom(fv);

  fv.aaViewer2 = createAAViewer(fv, fv.footer, d.sequence);
  ZoomingBehaviour.updateViewportFromChart(fv);
  ZoomingBehaviour.updateZoomFromChart(fv);
};

FeaturesViewer.prototype.drawCategories = function(data, fv) {
  _.each(data, function(category) {
    var found = _.find(fv.categories, function(cat) {
        return cat.name === category[0];
    });
    if (!found) {
        var catInfo = Constants.getCategoryInfo(category[0]);
        var container = fv.container.select('.up_pftv_category_' + category[0]);
        if (!container[0][0]) {
            container = fv.ontheFlyContainer.append('div').classed('up_pftv_category_' + category[0], true);
        }
        var cat = CategoryFactory.createCategory(category[0], category[1], catInfo, fv, container);
        fv.categories.push(cat);
    } else {
        found.repaint(category[1]);
    }
  });
};

module.exports = FeaturesViewer;
