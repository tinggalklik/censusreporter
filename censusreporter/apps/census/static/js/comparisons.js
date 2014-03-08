/*
Pass in an options object, fetch data, get back a comparison view.

Comparison({
    tableID: '{{ table }}', # string
    dataFormat: '{{ data_format }}', # 'table' or 'distribution'
    geoIDs: '{{ geo_list }}', # an array
    primaryGeoID: '{{ primary_geo_id }}', # string
    topicSelect: '#topic-select',
    topicSelectContainer: '#query-topic-picker',
    dataHeader: '#header-container',
    dataWrapper: '#data-display',
    dataContainer: '#data-container'
})

This expects to have Underscore, D3 and jQuery.
*/

function Comparison(options) {
    var comparison = {
        tableSearchAPI: 'http://api.censusreporter.org/1.0/table/search',
        geoSearchAPI: 'http://api.censusreporter.org/1.0/geo/search',
        rootGeoAPI: 'http://api.censusreporter.org/1.0/geo/tiger2012/',
        dataAPI: 'http://api.censusreporter.org/1.0/data/show/latest'
    };
    
    comparison.init = function(options) {
        // establish our base vars
        comparison.tableID = options.tableID;
        comparison.dataFormat = options.dataFormat;
        comparison.geoIDs = options.geoIDs;
        comparison.primaryGeoID = options.primaryGeoID || null;
        comparison.chosenSumlevAncestorList = '010,020,030,040,050,060,160,250,310,500,610,620,860,950,960,970';
        // jQuery things
        comparison.topicSelect = $(options.topicSelect);
        comparison.topicSelectContainer = $(options.topicSelectContainer);
        comparison.displayHeader = $(options.displayHeader);
        comparison.displayWrapper = $(options.displayWrapper);
        // D3 things
        comparison.headerContainer = d3.select(options.displayHeader);
        comparison.dataContainer = d3.select(options.dataContainer);
        comparison.aside = d3.select('aside');
        
        // add the "change table" widget and listener
        comparison.makeTopicSelectWidget();
        
        // go get the data
        comparison.getData();
        return comparison;
    }
    
    comparison.getData = function() {
        if (comparison.tableID && comparison.geoIDs) {
            var params = {
                table_ids: comparison.tableID,
                geo_ids: comparison.geoIDs.join(',')
            }
            $.getJSON(comparison.dataAPI, params)
                .done(function(results) {
                    comparison.data = comparison.cleanData(results);
                    comparison.addStandardMetadata();
                    comparison.makeDataDisplay();
                })
                .fail(function(xhr, textStatus, error) {
                    var message = $.parseJSON(xhr.responseText);
                    comparison.displayWrapper.html('<h1>Error</h1><p class="message display-type clearfix"><span class="message-error">'+message.error+'</span></p>');
                });
        }
        return comparison;
    }
    
    comparison.addStandardMetadata = function() {
        comparison.table = comparison.data.tables[comparison.tableID];
        comparison.release = comparison.data.release;
        comparison.values = comparison.data.data;
        comparison.thisSumlev = (!!comparison.primaryGeoID) ? comparison.primaryGeoID.substr(0,3) : null;
        comparison.statType = (comparison.table.title.toLowerCase().indexOf('dollars') !== -1) ? 'dollar' : 'number';
        comparison.denominatorColumn = comparison.table.denominator_column_id || null;
        comparison.valueType = (!!comparison.denominatorColumn) ? 'percentage' : 'estimate';

        // determine whether we have a primary geo to key off of
        if (!!comparison.primaryGeoID && !!comparison.data.geography[comparison.primaryGeoID]) {
            comparison.primaryGeoName = comparison.data.geography[comparison.primaryGeoID].name
        } else {
            // case where primaryGeoID is passed as param, but not part of data returned by API
            comparison.primaryGeoID = null
        }
        // validated list of geoIDs with data
        comparison.dataGeoIDs = _.keys(comparison.values);
        // create groupings of geoIDs by sumlev
        comparison.sumlevMap = comparison.makeSumlevMap();
    }
    
    comparison.makeDataDisplay = function() {
        if (comparison.dataFormat == 'table') {
            comparison.makeTableDisplay();
        }
        if (comparison.dataFormat == 'map') {
            comparison.makeMapDisplay();
        }
        if (comparison.dataFormat == 'distribution') {
            comparison.makeDistributionDisplay();
        }
    }



    // BEGIN THE MAP-SPECIFIC THINGS
    comparison.makeMapDisplay = function() {
        // some extra setup for map view
        // for triggering overflow-y: visible on table search
        comparison.lockedParent = $('#map-controls').css('max-height', function() {
            return (document.documentElement.clientHeight - 40) + 'px';
        })

        comparison.showStandardMetadata();
        comparison.addMapMetadata();

        comparison.makeMapDataSelector();
        comparison.makeMapLegendContainer();
        comparison.makeMapSumlevSelector();
        
        var geoAPI = "http://api.censusreporter.org/1.0/geo/show/tiger2012?geo_ids=" + comparison.geoIDs.join(','),
            allowMapDrag = (browserWidth > 480) ? true : false;
        
        d3.json(geoAPI, function(error, json) {
            if (error) return console.warn(error);

            comparison.geoFeatures = json.features;
            comparison.mergeData();

            // draw the base map
            comparison.map = L.mapbox.map('slippy-map', 'censusreporter.map-j9q076fv', {
                scrollWheelZoom: false,
                zoomControl: false,
                dragging: allowMapDrag,
                touchZoom: allowMapDrag
            });
            if (allowMapDrag) {
                comparison.map.addControl(new L.Control.Zoom({
                    position: 'topright'
                }));
            }

            // initial page load, make map with first column
            // and sumlev with the most geographies
            comparison.chosenColumn = comparison.columnKeys[0];
            comparison.changeMapControls();
            comparison.drawChoropleth();

            comparison.sumlevSelector.fadeIn();
            comparison.mapLegend.fadeIn();
            comparison.dataSelector.fadeIn();
        })
        
        comparison.addGeographyCompareTools();
        return comparison;
    }
    
    comparison.addMapMetadata = function() {
        // add the metadata to the header box
        var headerMetadataContainer = comparison.headerContainer.append('ul')
                .classed('metadata', true);
        headerMetadataContainer.append('li')
                .classed('bigger', true)
                .text('Table '+ comparison.tableID);
        headerMetadataContainer.append('li')
                .classed('bigger', true)
                .text(comparison.release.name);
        headerMetadataContainer.append('li')
                .html('<a id="change-table" href="#">Change table</a>');
        comparison.headerContainer.append('p')
                .classed('caption', true)
            .append('span')
                .classed('caption-group', true)
                .html('<strong>Table universe:</strong> '+ comparison.table.universe);
    }

    comparison.makeMapLegendContainer = function() {
        // add container for dynamically-built legend
        comparison.legendContainer = comparison.headerContainer.append('div')
                .classed('legend-bar', true)
            .append('div')
                .classed('tool-group', true)
                .attr('id', 'map-legend')
            .append('ul')
                .classed('quantile-legend', true);
                
        comparison.mapLegend = $('#map-legend');
    }

    comparison.makeMapDataSelector = function() {
        // add the "show column" picker
        var dataSelector = comparison.headerContainer.append('div')
                .classed('tool-group clearfix', true)
                .attr('id', 'column-select');

        dataSelector.append('h2')
                .classed('select-header', true)
                .text('Show column');
        
        var chosen = dataSelector.append('div')
                .classed('item-chosen', true)
                .attr('id', 'column-picker');
        
        var chosenTitle = chosen.append('h3')
                .classed('item-chosen-title', true);
        
        chosenTitle.append('i')
                .classed('fa fa-chevron-circle-down', true);

        chosenTitle.append('span')
                .attr('id', 'column-title-chosen');
        
        var chosenChoices = chosen.append('div')
                .classed('item-choices', true)
            .append('ul')
                .classed('filter-list clearfix', true)
                .attr('id', 'column-picker-choices');

        var makeColumnChoice = function(columnKey) {
            var columnData = comparison.columns[columnKey];
            var choice = '<li class="indent-'+columnData.indent+'">';
            if (columnKey.indexOf('.') != -1) {
                choice += '<span class="label">'+columnData.name+'</span>';
            } else {
                choice += '<a href="#" id="column-select-'+columnKey+'" data-value="'+columnKey+'" data-full-name="'+columnData.prefixed_name+'">'+columnData.name+'</a>'
            }
            choice += '</li>';

            return choice;
        }

        // prep the column keys and names
        comparison.columns = comparison.table.columns;
        if (!!comparison.denominatorColumn) {
            var columnChoiceDenominator = '<li class="indent-'+comparison.table.columns[comparison.denominatorColumn]['indent']+'"><span class="label">'+comparison.table.columns[comparison.denominatorColumn]['name']+'</span></li>';
            delete comparison.columns[comparison.denominatorColumn]
        }
        comparison.columnKeys = _.keys(comparison.columns);
        comparison.prefixColumnNames(comparison.columns, comparison.denominatorColumn);

        var columnChoices = d3.select('#column-picker-choices');
        columnChoices.selectAll("li")
                .data(comparison.columnKeys)
            .enter().append("li")
                .html(function(d) {
                    return makeColumnChoice(d);
                });

        if (!!comparison.denominatorColumn) {
            columnChoices.insert('li', ':first-child')
                .html(columnChoiceDenominator);
        }

        // set up dropdown listener for changing data column
        comparison.dataSelector = $('#column-select');
        comparison.dataSelector.on('click', '.item-chosen', function(e) {
            e.preventDefault();
            var chosenGroup = $(this);
            chosenGroup.toggleClass('open');
            chosenGroup.find('i[class^="fa "]').toggleClass('fa-chevron-circle-down fa-chevron-circle-up');
        });
        comparison.dataSelector.on('click', 'a', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var selected = $(this);
            comparison.chosenColumn = selected.data('value');
            comparison.dataSelector.find('a').removeClass('option-selected');
            selected.addClass('option-selected');
            var chosenGroup = $(this).closest('.item-chosen');
            chosenGroup.toggleClass('open');
            comparison.changeMapControls();
            comparison.drawChoropleth();
        });
    }

    comparison.makeMapSumlevSelector = function() {
        // add the "change summary level" picker

        comparison.sortedSumlevList = comparison.makeSortedSumlevMap(comparison.sumlevMap);
        comparison.chosenSumlev = comparison.sortedSumlevList[0]['sumlev'];

        var sumlevSelector = comparison.headerContainer.append('div')
                .classed('tool-group clearfix', true)
                .attr('id', 'sumlev-select');

        sumlevSelector.append('h2')
                .classed('select-header', true)
                .text('Show summary level');
        
        var chosen = sumlevSelector.append('div')
                .classed('item-chosen', true)
                .attr('id', 'sumlev-picker');
        
        var chosenTitle = chosen.append('h3')
                .classed('item-chosen-title', true);
        
        chosenTitle.append('i')
                .classed('fa fa-chevron-circle-down', true);

        chosenTitle.append('span')
                .attr('id', 'sumlev-title-chosen');
        
        var chosenChoices = chosen.append('div')
                .classed('item-choices', true)
            .append('ul')
                .classed('filter-list clearfix', true)
                .attr('id', 'sumlev-picker-choices');

        var sumlevChoices = d3.select('#sumlev-picker-choices');
        sumlevChoices.selectAll("li")
                .data(comparison.sortedSumlevList)
            .enter().append("li")
                .classed("indent-1", true)
                .html(function(d) {
                    var thisName = (d.name.name == 'nation') ? 'nation' : d.name.plural;
                    return '<a href="#" id="sumlev-select-'+d.sumlev+'" data-value="'+d.sumlev+'">'+comparison.capitalize(thisName)+'</a>';
                });

        // set up dropdown listener for changing summary level
        comparison.sumlevSelector = $('#sumlev-select');
        comparison.sumlevSelector.on('click', '.item-chosen', function(e) {
            e.preventDefault();
            var chosenGroup = $(this);
            chosenGroup.toggleClass('open');
            chosenGroup.find('i[class^="fa "]').toggleClass('fa-chevron-circle-down fa-chevron-circle-up');
        });
        comparison.sumlevSelector.on('click', 'a', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var selected = $(this);
            comparison.chosenSumlev = selected.data('value');
            comparison.sumlevSelector.find('a').removeClass('option-selected');
            selected.addClass('option-selected');
            var chosenGroup = $(this).closest('.item-chosen');
            chosenGroup.toggleClass('open');
            comparison.changeMapControls();
            comparison.drawChoropleth();
        });
    }
    
    comparison.changeMapControls = function() {
        // rebuild map controls with new data on select menu change
        var columnTitle = comparison.columns[comparison.chosenColumn]['prefixed_name'];
        d3.select("#column-title-chosen").text(columnTitle);
        var sumlevTitle = comparison.sumlevMap[comparison.chosenSumlev]['name']['plural'];
        d3.select("#sumlev-title-chosen").text(comparison.capitalize(sumlevTitle));
    }

    comparison.makeMapLabel = function(feature, column) {
        if (!!feature.properties.data) {
            var thisValue = feature.properties.data.estimate[column],
                thisValueMOE = feature.properties.data.error[column],
                thisPct = (!!comparison.denominatorColumn) ? feature.properties.data.percentage[column] : null,
                thisPctMOE = (!!comparison.denominatorColumn) ? feature.properties.data.percentage_error[column] : null,
                label = '<span class="label-title">' + feature.properties.name + '</span>';
                
            label += '<span class="name">' + comparison.columns[column]['prefixed_name'] + '</span>';
            label += '<span class="value">';
            if (!!thisPct) {
                label += '<span class="inline-stat">' + valFmt(thisPct, 'percentage');
                label += '<span class="context">&plusmn;' + valFmt(thisPctMOE, 'percentage') + '</span>'
                label += "</span>";
            }
            if (!!thisValue) {
                var openParen = (!!thisPct) ? '(' : null,
                    closeParen = (!!thisPct) ? ')' : null;
                label += '<span class="inline-stat">' + openParen + valFmt(thisValue, comparison.statType);
                label += '<span class="context">&plusmn;' + valFmt(thisValueMOE, comparison.statType) + '</span>';
                label += closeParen + '</span>';
            }
            label += '</span>';
        }
        return label;
    }

    comparison.mergeData = function() {
        // add table data to each geography's properties
        _.each(comparison.geoFeatures, function(e) {
            e.properties.data = comparison.values[e.properties.geoid][comparison.tableID];
            // add percentages if possible
            if (!!comparison.denominatorColumn) {
                e.properties.data.percentage = {};
                e.properties.data.percentage_error = {};
                _.each(comparison.columnKeys, function(k) {
                    var thisValue = e.properties.data.estimate[k],
                        thisValueMOE = e.properties.data.error[k],
                        thisDenominator = e.properties.data.estimate[comparison.denominatorColumn],
                        thisDenominatorMOE = e.properties.data.error[comparison.denominatorColumn];

                    e.properties.data.percentage[k] = calcPct(thisValue, thisDenominator);
                    e.properties.data.percentage_error[k] = calcPctMOE(thisValue, thisDenominator, thisValueMOE, thisDenominatorMOE);
                })
            }
        })
    }

    comparison.drawChoropleth = function() {
        // build map based on specific column of data
        if (comparison.featureLayer) {
            comparison.map.removeLayer(comparison.featureLayer);
        }
        
        var viewGeoData = _.filter(comparison.geoFeatures, function(g) {
            var thisSumlev = g.properties.geoid.slice(0, 3);
            return thisSumlev == comparison.chosenSumlev;
        })

        var values = d3.values(viewGeoData).map(function(d) {
            return d.properties.data[comparison.valueType][comparison.chosenColumn];
        });
        

        // create the legend
        var quintileColors = ['#d9ece8', '#a1cfc6', '#68b3a3', '#428476', '#264b44'];
        var buildLegend = function(colors) {
            var scaleStops = (values.length >= 5) ? 5 : values.length;

            comparison.quantize = d3.scale.quantile()
                .domain([d3.min(values), d3.max(values)])
                .range(d3.range(scaleStops));

            colors = _.last(colors, scaleStops);
            comparison.colors = colors.slice(0);
            colors.unshift(null);

            comparison.legendContainer.selectAll('li').remove();
            comparison.legendContainer.selectAll('li')
                    .data(colors)
                .enter().append('li')
                    .style('background-color', function(d) { if (d) { return d }})
                    .classed('empty', function(d) { return (d == null) })
                .append('span')
                    .classed('quantile-label', true);
        }
        buildLegend(quintileColors);

        // add the actual label values
        var labelData = comparison.quantize.quantiles().slice(0);
        labelData.unshift(d3.min(values));
        labelData.push(d3.max(values));
        var legendLabels = d3.select("#map-legend")
            .selectAll("span")
            .data(labelData)
            .text(function(d){
                if (typeof(d) != 'undefined') {
                    if (!!comparison.denominatorColumn) {
                        return roundNumber(d, 1) + '%'
                    } else {
                        var prefix = (comparison.statType == 'dollar') ? '$' : '';
                        return prefix + numberWithCommas(d)
                    }
                }
            });

        var styleFeature = function(feature) {
            return {
                fillColor: comparison.colors[
                    comparison.quantize(feature.properties.data[comparison.valueType][comparison.chosenColumn])
                ],
                weight: 1.0,
                opacity: 1.0,
                color: '#fff',
                fillOpacity: 1.0
            };
        }
        
        comparison.featureLayer = L.geoJson(viewGeoData, {
            style: styleFeature,
            onEachFeature: function(feature, layer) {
                var label = comparison.makeMapLabel(feature, comparison.chosenColumn);
                layer.bindLabel(label, {className: 'hovercard', direction: 'auto'});
                layer.on('click', function() {
                    window.location.href = '/profiles/' + feature.properties.geoid + '-' + slugify(feature.properties.name);
                });
            }
        });
        comparison.map.addLayer(comparison.featureLayer);
        var objBounds = comparison.featureLayer.getBounds();
        if (comparison.chosenSumlev === '040') {
            var geoIDList = _.map(viewGeoData, function(g) {
                return g.properties.geoid
            })
            if ((_.indexOf(geoIDList, '04000US02') > -1) || (_.indexOf(geoIDList, '04000US15') > -1)) {
                objBounds = L.latLngBounds(L.latLng(17.831509, -179.231086), L.latLng(71.4410, -66.9406));
            }
        }

        if (browserWidth > 768) {
            var z,
                targetWidth = browserWidth - 100,
                targetHeight = browserHeight - 100;
            for(z = 16; z > 2; z--) {
                var swPix = comparison.map.project(objBounds.getSouthWest(), z),
                    nePix = comparison.map.project(objBounds.getNorthEast(), z),
                    pixWidth = Math.abs(nePix.x - swPix.x),
                    pixHeight = Math.abs(nePix.y - swPix.y);
                if (pixWidth < targetWidth && pixHeight < targetHeight) {
                    break;
                }
            }
            comparison.map.setView(objBounds.getCenter(), z);
            if (browserWidth < 1600) {
                comparison.map.panBy([-200, 0], {animate: false});
            }
        } else {
            comparison.map.fitBounds(objBounds);
        }
    }

    // DONE WITH THE MAP-SPECIFIC THINGS









    comparison.makeTableDisplay = function() {
        comparison.showStandardMetadata();
        
        var dataContainer = d3.select('#data-display'),
            gridData = {
                Head: [],
                Body: []
            };
        
        // tableID and change table link
        dataContainer.select('h1').text('Table ' + comparison.tableID)
                .append('a')
            .attr('id', 'change-table')
            .attr('href', '#')
            .text('Change');

        dataContainer.select('h2').text(comparison.release.name);

        // for long table titles, bump down the font size
        if (comparison.table.title.length > 160) {
            comparison.headerContainer.select('h1')
                .style('font-size', '1.6em');
        }

        // build the header
        var sortedPlaces = comparison.getSortedPlaces('name'),
            gridHeaderBits = ['<i class="fa fa-long-arrow-right"></i>Column'];

        sortedPlaces.forEach(function(g) {
            var geoID = g.geoID,
                geoName = comparison.data.geography[geoID].name;
            gridHeaderBits.push('<a href="/profiles/' + geoID + '-' + slugify(geoName) + '">' + geoName + '</a>');
        })
        gridData.Head.push(gridHeaderBits);

        // build the columns
        comparison.columns = d3.map(comparison.table.columns);
        comparison.columns.forEach(function(k, v) {
            var truncatedName = function() {
                return (v.name.length > 50) ? v.name.substr(0,50) + "..." : v.name;
            }
            var gridRowBits = ['<div class="name indent-' + v.indent + '" data-full-name="' + v.name + '">' + truncatedName() + '</div>'];

            sortedPlaces.forEach(function(g) {
                var geoID = g.geoID,
                    thisValue = comparison.values[geoID][comparison.tableID].estimate[k],
                    thisValueMOE = comparison.values[geoID][comparison.tableID].error[k]
                    gridRowCol = '';

                // provide percentages first, to match chart style
                if (!!comparison.denominatorColumn) {
                    var thisDenominator = comparison.values[geoID][comparison.tableID].estimate[comparison.denominatorColumn],
                        thisDenominatorMOE = comparison.values[geoID][comparison.tableID].error[comparison.denominatorColumn];

                    if (thisValue >= 0) {
                        gridRowCol += '<span class="value percentage">' + valFmt(calcPct(thisValue, thisDenominator), 'percentage') + '</span>';
                        gridRowCol += '<span class="context percentage">&plusmn;' + valFmt(calcPctMOE(thisValue, thisDenominator, thisValueMOE, thisDenominatorMOE), 'percentage') + '</span>';
                    }
                }

                // add raw numbers
                if (thisValue >= 0) {
                    gridRowCol += '<span class="value number">' + valFmt(thisValue, comparison.statType) + '</span>';
                    gridRowCol += '<span class="context number">&plusmn;' + valFmt(thisValueMOE, comparison.statType) + '</span>';
                }
                gridRowBits.push(gridRowCol);
            })
            gridData.Body.push(gridRowBits);
        })

        // show the grid
        comparison.resultsContainerID = 'data-results';
        comparison.dataContainer.append('div')
            .classed('data-drawer grid', true)
            .attr('id', comparison.resultsContainerID)
            .style('height', '100%')
            .style('width', '100%')
            .style('overflow', 'hidden');
            
        comparison.grid = new Grid(comparison.resultsContainerID, {
            srcType: "json",
            srcData: gridData,
            allowColumnResize: true,
            fixedCols: 1,
            onResizeColumn: function() {
                $('.name').text(function() { return $(this).data('full-name') })
            }
        });

        // add some table controls and notes
        if (!!comparison.denominatorColumn) {
            comparison.addNumberToggles();
        }
        d3.select('#tool-notes').append('div')
                .classed('tool-group', true)
                .text('Click a row to highlight');

        // be smart about fixed height
        comparison.dataDisplayHeight = $('#data-results').height()+20;
        comparison.setResultsContainerHeight();
        $(window).resize(comparison.setResultsContainerHeight);
        
        // add hover listeners for grid rows
        $("#data-display").on('mouseover', '.g_BR', function(e) {
            var thisClass = $(this).attr('class').split(' ');
            var thisRow = $.grep(thisClass, function(c) {
                return c.substr(0,3) == 'g_R';
            });
            $('.'+thisRow+':not(.g_HR)').addClass('hover');
        });

        $("#data-display").on('mouseleave', '.g_BR', function(e) {
            var thisClass = $(this).attr('class').split(' ');
            var thisRow = $.grep(thisClass, function(c) {
                return c.substr(0,3) == 'g_R';
            });
            $('.'+thisRow+':not(.g_HR)').removeClass('hover');
        });
    
        $("#data-display").on('click', '.g_BR', function(e) {
            var thisClass = $(this).attr('class').split(' ');
            var thisRow = $.grep(thisClass, function(c) {
                return c.substr(0,3) == 'g_R';
            });
            $('.'+thisRow+':not(.g_HR)').toggleClass('highlight');
        });

        // add the comparison links, names, and typeahead
        comparison.addGeographyCompareTools();
        return comparison;
    }

    comparison.makeDistributionDisplay = function() {
        comparison.showStandardMetadata();
        
        var dataContainer = d3.select('#data-display'),
            resultsContainer = d3.select('#data-container');

        // tableID and change table link
        dataContainer.select('h1').text('Table ' + comparison.tableID)
                .append('a')
            .attr('id', 'change-table')
            .attr('href', '#')
            .text('Change');
            
        dataContainer.select('h2').text(comparison.release.name);

        // for long table titles, bump down the font size
        if (comparison.table.title.length > 160) {
            comparison.headerContainer.select('h1')
                .style('font-size', '1.6em')
        }

        var notes = d3.select('#tool-notes');
        notes.append('div')
            .classed('tool-group', true)
            .text('Click a point to lock display');

        var placeSelect = notes.append('div')
                .classed('tool-group', true)
                .text('Find ')
            .append('select')
                .attr('id', 'coal-picker')
                .attr('data-placeholder', 'Select a geography');
        //select2 needs an empty container first for placeholder
        placeSelect.append('option');

        var sortedPlaces = comparison.getSortedPlaces('name');
        placeSelect.selectAll('.geo')
                .data(sortedPlaces)
            .enter().append('option')
                .classed('geo', true)
                .attr('value', function(d) {
                    return 'geography-'+d.geoID;
                })
                .text(function(d) { return d.name });

        comparison.charts = {};
        comparison.columnKeys = _.keys(comparison.table.columns);
        comparison.columns = d3.map(comparison.table.columns);
        if (!!comparison.denominatorColumn) {
            comparison.columns.remove(comparison.denominatorColumn)
        }
        comparison.prefixColumnNames(comparison.columns, comparison.denominatorColumn);
        
        // add percentage values to each geography
        if (!!comparison.denominatorColumn) {
            _.each(comparison.values, function(e) {
                var thisData = e[comparison.tableID];
                thisData.percentage = {};
                thisData.percentage_error = {};
                _.each(comparison.columnKeys, function(k) {
                    var thisValue = thisData.estimate[k],
                        thisValueMOE = thisData.error[k],
                        thisDenominator = thisData.estimate[comparison.denominatorColumn],
                        thisDenominatorMOE = thisData.error[comparison.denominatorColumn];

                    thisData.percentage[k] = calcPct(thisValue, thisDenominator);
                    thisData.percentage_error[k] = calcPctMOE(thisValue, thisDenominator, thisValueMOE, thisDenominatorMOE);
                })
            })
        }
        
        // build a chart for each column in the table
        comparison.columns.forEach(function(k, v) {
            var columnData = { column: k },
                geoColumnData = {};

            var valuesList = _.map(comparison.values, function(g) { return g[comparison.tableID][comparison.valueType][k] });

            columnData.minValue = d3.min(valuesList);
            columnData.maxValue = d3.max(valuesList);
            columnData.valuesRange = columnData.maxValue - columnData.minValue;
            columnData.medianValue = d3.median(valuesList);

            var xScale = d3.scale.linear()
                .range([0, 100])
                .domain([columnData.minValue, columnData.maxValue]);
            columnData.medianPctOfRange = roundNumber(xScale(columnData.medianValue), 1);

            comparison.charts[k] = resultsContainer.append('section')
                    .attr('class', 'coal-chart-container')
                    .attr('id', 'coal-chart-'+k)

            comparison.charts[k].append('h2')
                    .attr('id', k)
                    .html('<a class="permalink" href="#'+k+'">'+v.prefixed_name+' <i class="fa fa-link"></i></a>');

            var chart = comparison.charts[k].append('ul')
                .attr('class', 'coal-chart');

            chart.append('li')
                .attr('class', 'tick-mark tick-mark-min')
                .html('<span><b>Min:</b> '+columnData.minValue+'</span>');

            chart.append('li')
                .attr('class', 'tick-mark')
                .attr('style', 'left:'+columnData.medianPctOfRange+'%;')
                .html(function() {
                    var marginTop = (columnData.medianPctOfRange < 12 || columnData.medianPctOfRange > 88) ? 'margin-top:38px;' : '';
                    return '<span style="'+marginTop+'"><b>Median:</b> '+columnData.medianValue+'</span>';
                });

            chart.append('li')
                .attr('class', 'tick-mark tick-mark-max')
                .html('<span><b>Max:</b> '+columnData.maxValue+'</span>');

            sortedPlaces.forEach(function(g) {
                var geoID = g.geoID,
                    thisValue = comparison.values[geoID][comparison.tableID].estimate[k],
                    thisValueMOE = comparison.values[geoID][comparison.tableID].error[k];
            
                geoColumnData[geoID] = {
                    name: comparison.data.geography[geoID].name,
                    value: thisValue,
                    displayValue: thisValue,
                    displayFmt: comparison.statType,
                    geoID: geoID
                }

                if (!!comparison.denominatorColumn) {
                    var thisDenominator = comparison.values[geoID][comparison.tableID].estimate[comparison.denominatorColumn],
                        thisDenominatorMOE = comparison.values[geoID][comparison.tableID].error[comparison.denominatorColumn],
                        thisPct = calcPct(thisValue, thisDenominator);

                    geoColumnData[geoID].value_pct = thisPct;
                    geoColumnData[geoID].displayValue = thisPct;
                    geoColumnData[geoID].displayFmt = 'percentage';
                }
            })
            columnData.geographies = geoColumnData;

            var chartPoints = chart.selectAll('.chart-point')
                    .data(d3.values(columnData.geographies))
                .enter().append('li')
                    .classed('chart-point', true)
                    .style('left', function(d) {
                        return roundNumber(xScale(d.displayValue), 1)+'%';
                    });
                    
            var chartPointCircles = chartPoints.append('a')
                    .attr('data-index', function(d) {
                        return 'geography-'+d.geoID;
                    });
                    
            var chartPointLabels = chartPointCircles.append('span')
                    .classed('hovercard', true);
                    
            chartPointLabels.append('span')
                    .classed('name', true)
                    .text(function(d) { return d.name });
            chartPointLabels.append('span')
                    .classed('value percentage', true)
                    .text(function(d) { return valFmt(d.displayValue, d.displayFmt) });
        })

        // add the comparison links, names, and typeahead
        comparison.addGeographyCompareTools();

        // set up the chart point listeners
        var coalCharts = $('.coal-chart'),
            coalChartPoints = $('.coal-chart a'),
            placePicker = $('#coal-picker');

        coalCharts.on('mouseover', 'a', function(e) {
            var chosenIndex = $(this).data('index'),
                filteredPoints = coalChartPoints.filter('[data-index='+chosenIndex+']');

            filteredPoints.addClass('hovered');
            filteredPoints.children('span').css('display', 'block');
        })
        coalCharts.on('mouseout', 'a', function(e) {
            coalChartPoints.removeClass('hovered');
            coalChartPoints.children('span').removeAttr('style');
        })
        coalCharts.on('click', 'a', function(e) {
            e.preventDefault();
            toggleSelectedPoints($(this).data('index'));
        })

        // add the place picker to highlight points on charts
        placePicker.select2({
            placeholder: 'Select a geography',
            width: 'resolve'
        });
        placePicker.on('change', function(e) {
            toggleSelectedPoints($(this).val());
        })

        // color scale for locked chart points
        var colorScale = chroma.scale('RdYlBu').domain([0,6]),
            colorIndex = 0;
        var toggleSelectedPoints = function(chosenIndex) {
            var filteredPoints = coalChartPoints.filter('[data-index='+chosenIndex+']');
            // if adding a new selection, pick next color in scale
            if (!filteredPoints.hasClass('selected')) {
                targetColor = colorScale((colorIndex+=1) % 6);
            }
            filteredPoints.toggleClass('selected').removeAttr('style').filter('.selected').css({
                'background-color': targetColor.hex(),
                'border-color': targetColor.darken(20).hex()
            });
        }
        return comparison;
    }


    // utilities
    comparison.showStandardMetadata = function() {
        // fill in some metadata and instructions
        d3.select('#table-universe').html('<strong>Table universe:</strong> ' + comparison.table.universe);
        comparison.aside.selectAll('.hidden')
            .classed('hidden', false);
        comparison.headerContainer.append('h1').text(comparison.table.title);
    }


    // typeahead autocomplete setup
    comparison.topicSelectEngine = new Bloodhound({
        datumTokenizer: function(d) { return Bloodhound.tokenizers.whitespace(d.full_name); },
        queryTokenizer: Bloodhound.tokenizers.whitespace,
        limit: 1500,
        remote: {
            url: comparison.tableSearchAPI,
            replace: function (url, query) {
                url += '?';
                if (query) {
                    url += 'q=' + query;
                }
                return url;
            },
            filter: function(response) {
                var resultNumber = response.length;
                if (resultNumber === 0) {
                    response.push({
                        table_name: 'Sorry, no matches found. Try changing your search.'
                    });
                }
                response.map(function(item) {
                    if (!!item['topics']) {
                        item['topic_string'] = item['topics'].join(', ');
                    }
                });
                return response;
            }
        }
    });
    
    comparison.makeTopicSelectWidget = function() {
        comparison.topicSelectEngine.initialize();

        var element = comparison.topicSelect;
        
        element.typeahead('destroy');
        element.typeahead({
            autoselect: true,
            highlight: false,
            hint: false,
            minLength: 2
        }, {
            name: 'topics',
            displayKey: 'simple_table_name',
            source: comparison.topicSelectEngine.ttAdapter(),
            templates: {
                suggestion: Handlebars.compile(
                    [
                        '{{#if table_id}}<h5 class="result-type">{{#if column_name}}Column in {{/if}}Table {{table_id}}</h5>{{/if}}',
                        '<p class="result-name">{{simple_table_name}}</p>',
                        '{{#if column_name}}<p class="caption"><strong>Column name:</strong> {{column_name}}</p>{{/if}}',
                        '{{#if topic_string}}<p class="caption"><strong>Table topics:</strong> {{topic_string}}</p>{{/if}}'
                    ].join('')
                )
            }
        });

        element.on('typeahead:selected', function(obj, datum) {
            comparison.tableID = datum['table_id'];

            var url = comparison.buildComparisonURL(
                comparison.dataFormat, comparison.tableID, comparison.geoIDs, comparison.primaryGeoID
            );
            window.location = url;
            // TODO: pushState to maintain history without page reload
        });

        // standard listeners
        comparison.displayWrapper.on('click', '#change-table', function(e) {
            e.preventDefault();
            comparison.toggleTableSearch();
        });
        
        return comparison;
    }
    
    comparison.geoSelectEngine = new Bloodhound({
        datumTokenizer: function(d) { return Bloodhound.tokenizers.whitespace(d.full_name); },
        queryTokenizer: Bloodhound.tokenizers.whitespace,
        limit: 20,
        remote: {
            url: geoSearchAPI,
            replace: function (url, query) {
                return url += '?q=' + query + '&sumlevs=' + comparison.chosenSumlevAncestorList;
            },
            filter: function(response) {
                var results = response.results;
                results.map(function(item) {
                    item['sumlev_name'] = sumlevMap[item['sumlevel']]['name'];
                });
                return results;
            }
        }
    });
    
    comparison.sumlevSelectEngine = new Bloodhound({
        datumTokenizer: function(d) { return Bloodhound.tokenizers.whitespace(d.plural_name); },
        queryTokenizer: Bloodhound.tokenizers.whitespace,
        local: [
            {name: 'state', plural_name: 'states', sumlev: '040', ancestor_sumlev_list: '010,020,030', ancestor_options: 'the United States' },
            {name: 'county', plural_name: 'counties', sumlev: '050', ancestor_sumlev_list: '010,020,030,040', ancestor_options: 'the United States or a state' },
            {name: 'county subdivision', plural_name: 'county subdivisions', sumlev: '060', ancestor_sumlev_list: '010,020,030,040,050', ancestor_options: 'the United States, a state or county' },
            {name: 'place', plural_name: 'places', sumlev: '160', ancestor_sumlev_list: '010,020,030,040,050', ancestor_options: 'the United States, a state or county' },
            {name: 'metro area', plural_name: 'metro areas', sumlev: '310', ancestor_sumlev_list: '010,020,030,040', ancestor_options: 'the United States or a state' },
            {name: 'native area', plural_name: 'native areas', sumlev: '250', ancestor_sumlev_list: '010,020,030,040', ancestor_options: 'the United States or a state' },
            {name: 'census tract', plural_name: 'census tracts', sumlev: '140', ancestor_sumlev_list: '010,020,030,040,050,160', ancestor_options: 'the United States, a state, county or place' },
            {name: 'block group', plural_name: 'block groups', sumlev: '150', ancestor_sumlev_list: '010,020,030,040,050,140,160', ancestor_options: 'the United States, a state, county, place or census tract' },
            {name: 'zip codes', plural_name: 'ZIP codes', sumlev: '860', ancestor_sumlev_list: '010,020,030,040,050,160', ancestor_options: 'the United States, a state, county or place' },
            {name: 'congressional district', plural_name: 'congressional districts', sumlev: '500', ancestor_sumlev_list: '010,020,030,040', ancestor_options: 'the United States or a state' },
            {name: 'state senate district', plural_name: 'state senate districts', sumlev: '610', ancestor_sumlev_list: '010,020,030,040', ancestor_options: 'the United States or a state' },
            {name: 'state house district', plural_name: 'state house districts', sumlev: '620', ancestor_sumlev_list: '010,020,030,040', ancestor_options: 'the United States or a state' },
            {name: 'voting tabulation district', plural_name: 'voting tabulation districts', sumlev: '700', ancestor_sumlev_list: '010,020,030,040,050', ancestor_options: 'the United States, a state or county' },
            {name: 'elementary school district', plural_name: 'elementary school districts', sumlev: '950', ancestor_sumlev_list: '010,020,030,040,050', ancestor_options: 'the United States, a state or county' },
            {name: 'secondary school district', plural_name: 'secondary school districts', sumlev: '960', ancestor_sumlev_list: '010,020,030,040,050', ancestor_options: 'the United States, a state or county' },
            {name: 'unified school district', plural_name: 'unified school districts', sumlev: '970', ancestor_sumlev_list: '010,020,030,040,050', ancestor_options: 'the United States, a state or county'}
        ]
    });

    comparison.makeGeoSelectWidget = function() {
        comparison.geoSelectEngine.initialize();
        comparison.sumlevSelectEngine.initialize();

        comparison.geoSelectContainer = comparison.aside.append('div')
            .attr('class', 'aside-block search hidden')
            .attr('id', 'comparison-add');

        comparison.geoSelectContainer.append('a')
                .classed('action-button', true)
                .attr('href', '#')
                .text('Show selected places')
                .on('click', function() {
                    d3.event.preventDefault();
                    comparison.toggleGeoControls();
                })

        comparison.geoSelectContainer.append('p')
            .attr('class', 'bottom display-type strong')
            .attr('id', 'comparison-add-header')
            .text('Add a geography');

        comparison.geoSelectContainer.append('input')
            .attr('name', 'geography_add')
            .attr('id', 'geography-add')
            .attr('type', 'text')
            .attr('placeholder', 'Find a place')
            .attr('autocomplete', 'off');

        var element = $('#geography-add');
        element.typeahead({
            autoselect: true,
            highlight: false,
            hint: false,
            minLength: 2
        }, {
            name: 'summary_levels',
            displayKey: 'plural_name',
            source: comparison.sumlevSelectEngine.ttAdapter(),
            templates: {
                header: '<h2>Summary levels</h2>',
                suggestion: Handlebars.compile(
                    '<p class="result-name">{{plural_name}}<span class="result-type">{{sumlev}}</span></p>'
                )
            }
        }, {
            name: 'geographies',
            displayKey: 'full_name',
            source: comparison.geoSelectEngine.ttAdapter(),
            templates: {
                header: '<h2>Geographies</h2>',
                suggestion: Handlebars.compile(
                    '<p class="result-name">{{full_name}}<span class="result-type">{{sumlev_name}}</span></p>'
                )
            }
        });

        element.on('typeahead:selected', function(event, datum) {
            event.stopPropagation();

            if (!datum['full_geoid']) {
                // we have a sumlev choice, so provide a parent input
                comparison.chosenSumlev = datum['sumlev'];
                comparison.chosenSumlevPluralName = datum['plural_name'];
                comparison.chosenSumlevAncestorList = datum['ancestor_sumlev_list'],
                comparison.chosenSumlevAncestorOptions = datum['ancestor_options'];

                comparison.makeParentSelectWidget();
                $('#geography-add-parent-container').slideDown();
                $('#geography-add-parent').focus();
            } else {
                // we have a geoID, so add it
                comparison.geoIDs.push(datum['full_geoid']);
                var url = comparison.buildComparisonURL(
                    comparison.dataFormat, comparison.tableID, comparison.geoIDs, comparison.primaryGeoID
                );
                window.location = url;
            }
            // TODO: pushState to maintain history without page reload
        });
    }
    
    comparison.makeParentSelectWidget = function() {
        var parentContainer = comparison.geoSelectContainer.append('div')
                .attr('id', 'geography-add-parent-container')
                .classed('hidden', true);

        parentContainer.append('p')
                .attr('class', 'bottom display-type strong')
                .html('&hellip; in &hellip;');
        
        parentContainer.append('input')
                .attr('name', 'geography_add_parent')
                .attr('id', 'geography-add-parent')
                .attr('type', 'text')
                .attr('placeholder', 'Find a place')
                .attr('autocomplete', 'off');
                
        parentContainer.append('p')
                .attr('class', 'display-type')
                .text(comparison.capitalize(comparison.chosenSumlevPluralName) + ' can be compared within ' + comparison.chosenSumlevAncestorOptions + '.');

        var element = $('#geography-add-parent');
        element.typeahead({
            autoselect: true,
            highlight: false,
            hint: false,
            minLength: 2
        }, {
            name: 'geographies',
            displayKey: 'full_name',
            source: comparison.geoSelectEngine.ttAdapter(),
            templates: {
                header: '<h2>Geographies</h2>',
                suggestion: Handlebars.compile(
                    '<p class="result-name">{{full_name}}<span class="result-type">{{sumlev_name}}</span></p>'
                )
            }
        });

        if (comparison.chosenSumlev == '040') {
            element.typeahead('val', 'United States');
        }

        element.on('typeahead:selected', function(event, datum) {
            event.stopPropagation();

            comparison.geoIDs.push(comparison.chosenSumlev + '|' + datum['full_geoid']);
            comparison.primaryGeoID = datum['full_geoid'];
            var url = comparison.buildComparisonURL(
                comparison.dataFormat, comparison.tableID, comparison.geoIDs, comparison.primaryGeoID
            );
            window.location = url;
            // TODO: pushState to maintain history without page reload
        });
    }
    
    comparison.makeParentOptions = function() {
        // no tribbles!
        d3.selectAll('#comparison-parents').remove();
        
        if (!!comparison.primaryGeoID && comparison.thisSumlev != '010') {
            var parentGeoAPI = comparison.rootGeoAPI + comparison.primaryGeoID + '/parents',
                parentOptionsContainer = comparison.aside.append('div')
                    .attr('class', 'aside-block hidden')
                    .attr('id', 'comparison-parents');

            $.getJSON(parentGeoAPI)
                .done(function(results) {
                    parentOptionsContainer.append('p')
                        .attr('class', 'bottom display-type strong')
                        .html('Add all ' + sumlevMap[comparison.thisSumlev]['plural'] + ' in&nbsp;&hellip;');

                    parentOptionsContainer.append('ul')
                            .attr('class', 'sumlev-list')
                        .selectAll('li')
                            .data(results['parents'])
                        .enter().append('li').append('a')
                            .attr('href', function(d) {
                                var newGeoIDs = comparison.geoIDs.slice(0);
                                newGeoIDs.push(comparison.thisSumlev + '|' + d.geoid);

                                return comparison.buildComparisonURL(
                                    comparison.dataFormat, comparison.tableID, newGeoIDs, comparison.primaryGeoID
                                )
                            })
                            .text(function(d) { return d.display_name });

                });
        }
        return comparison;
    }

    comparison.makeChildOptions = function() {
        // no tribbles!
        d3.selectAll('#comparison-children').remove();

        if (!!comparison.primaryGeoID && comparison.thisSumlev != '150') {
            var childOptionsContainer = comparison.aside.append('div')
                    .attr('class', 'aside-block hidden')
                    .attr('id', 'comparison-children');

            childOptionsContainer.append('p')
                    .attr('class', 'bottom display-type strong')
                    .html('Add &hellip;');

            childOptionsContainer.append('ul')
                    .attr('class', 'sumlev-list')
                .selectAll('li')
                    .data(sumlevChildren[comparison.thisSumlev])
                .enter().append('li').append('a')
                    .attr('href', function(d) {
                        var newGeoIDs = comparison.geoIDs.slice(0);
                        newGeoIDs.push(d + '|' + comparison.primaryGeoID);

                        return comparison.buildComparisonURL(
                            comparison.dataFormat, comparison.tableID, newGeoIDs, comparison.primaryGeoID
                        )
                    })
                    .text(function(d) { return sumlevMap[d]['plural'] });

            if (!!comparison.primaryGeoName) {
                childOptionsContainer.append('p')
                        .attr('class', 'display-type strong')
                        .html('&hellip; in ' + comparison.primaryGeoName);
            }
        }
        return comparison;
    }

    comparison.makeChosenGeoList = function() {
        // no tribbles!
        d3.selectAll('#comparison-chosen-geos').remove();

        var chosenGeoContainer = comparison.aside.append('div')
                .attr('class', 'aside-block')
                .attr('id', 'comparison-chosen-geos');

        chosenGeoContainer.append('a')
                .classed('action-button', true)
                .attr('href', '#')
                .text('Add more places')
                .on('click', function() {
                    d3.event.preventDefault();
                    comparison.toggleGeoControls();
                })

        chosenGeoContainer.append('p')
                .attr('class', 'bottom display-type strong')
                .html('Selected geographies');

        var geoOptions = _.flatten(_.map(comparison.sumlevMap, function(s) {
            return s.selections
        }))

        var chosenGeoOptions = chosenGeoContainer.append('ul')
                .attr('class', 'sumlev-list')
            .selectAll('li')
                .data(geoOptions)
            .enter().append('li')
                .attr('data-geoid', function(d) { return d.geoID })
                .text(function(d) { return d.name });
                
        if (geoOptions.length > 1) {
            var removeGeoOptions = chosenGeoOptions.append('a')
                    .classed('remove', true)
                    .attr('href', '#')
                    .attr('data-geoid', function(d) { return d.geoID })
                    .html('<small>Remove</small>')
                    .on('click', function(d) {
                        comparison.removeGeoID(d.geoID)
                    });
        }
                
        return comparison;
    }
    
    comparison.toggleGeoControls = function() {
        $('#comparison-chosen-geos, #comparison-add, #comparison-parents, #comparison-children, #map-data #data-display').toggle();
        if (!!comparison.lockedParent) {
            var toggledY = (comparison.lockedParent.css('overflow-y') == 'auto') ? 'visible' : 'auto';
            comparison.lockedParent.css('overflow-y', toggledY);
        }
    }
    
    comparison.toggleTableSearch = function() {
        comparison.displayHeader.toggle();
        comparison.displayWrapper.toggle();

        if (!!comparison.lockedParent) {
            comparison.lockedParent.find('aside').toggle();
            comparison.lockedParent.css('overflow-y', 'visible');
        }

        comparison.topicSelectContainer.toggle();
        comparison.topicSelect.focus();
    }
    
    comparison.addGeographyCompareTools = function() {
        // add typeahead place picker
        comparison.makeGeoSelectWidget();
        
        if (!!comparison.primaryGeoID && !!comparison.primaryGeoName) {
            // create shortcuts for adding groups of geographies to comparison
            comparison.makeParentOptions();
            comparison.makeChildOptions();

            // update the place name in table search header
            comparison.topicSelectContainer.find('h1').text('Find data for ' + comparison.primaryGeoName);
        }
        
        // show the currently selected geographies
        comparison.makeChosenGeoList();
    }
    
    comparison.addNumberToggles = function() {
        $('.number').hide();

        var notes = d3.select('#tool-notes'),
            toggle = notes.append('div')
                    .classed('tool-group', true)
                .append('a')
                    .classed('toggle-control', true)
                    .attr('id', 'show-number')
                    .text('Switch to totals');

        var toggleControl = $('.toggle-control');
        toggleControl.on('click', function() {
            var clicked = $(this),
                showClass = clicked.attr('id').replace('show-','.'),
                hideClass = (showClass == '.number') ? '.percentage' : '.number',
                toggleID = (showClass == '.number') ? 'show-percentage' : 'show-number',
                toggleText = (showClass == '.number') ? 'Switch to percentages' : 'Switch to totals';

            toggleControl.attr('id', toggleID).text(toggleText);
            $(hideClass).css('display', 'none');
            $(showClass).css('display', 'inline-block');
        })
        return comparison;
    }
    
    
    // UTILITIES
    
    comparison.buildComparisonURL = function(dataFormat, tableID, geoIDs, primaryGeoID) {
        // pass in vars rather than use them from comparison object
        // so they can be created to arbitrary destinations

        var url = '/data/'+dataFormat+'/?table='+tableID;
        if (!!geoIDs) {
            url += "&geo_ids=" + geoIDs.join(',')
        }
        if (!!primaryGeoID) {
            url += "&primary_geo_id=" + primaryGeoID
        }
        
        return url
    }
    
    comparison.removeGeoID = function(geoID) {
        d3.event.preventDefault();
        
        var theseGeoIDs = _.filter(comparison.geoIDs.slice(0), function(g) {
            return g != geoID;
        })
        if (comparison.primaryGeoID == geoID) {
            comparison.primaryGeoID = null;
        }

        var url = comparison.buildComparisonURL(
            comparison.dataFormat, comparison.tableID, theseGeoIDs, comparison.primaryGeoID
        );
        window.location = url;
    }

    comparison.setResultsContainerHeight = _.debounce(function() {
        // redraw to match new dimensions
        window.browserWidth = document.documentElement.clientWidth;
        window.browserHeight = document.documentElement.clientHeight;

        // use options.dataContainer
        var top = document.getElementById(comparison.resultsContainerID).getBoundingClientRect().top,
            maxContainerHeight = Math.floor(browserHeight - top - 20),
            bestHeight = (comparison.dataDisplayHeight < maxContainerHeight) ? comparison.dataDisplayHeight : maxContainerHeight;

        $('#'+comparison.resultsContainerID).css('height', bestHeight+'px');
    }, 100);

    comparison.getSortedPlaces = function(field) {
        var sortedPlaces = _.map(comparison.data.data, function(v, k) {
            return {
                geoID: k,
                name: comparison.data.geography[k]['name']
            }
        }).sort(comparison.sortDataBy(field));

        return sortedPlaces
    }

    comparison.sortDataBy = function(field, sortFunc) {
        // allow reverse sorts, e.g. '-value'
        var sortOrder = (field[0] === "-") ? -1 : 1;
        if (sortOrder == -1) {
            field = field.substr(1);
        }

        // allow passing in a sort function
        var key = sortFunc ? function (x) { return sortFunc(x[field]); } : function (x) { return x[field]; };

        return function (a,b) {
            var A = key(a), B = key(b);
            return ((A < B) ? -1 : (A > B) ? +1 : 0) * sortOrder;
        }
    }
    
    comparison.cleanData = function(data) {
        //  remove non-data headers that are the first field in the table,
        // which simply duplicate information from the table name.
        _.each(_.keys(data.tables[comparison.tableID]['columns']), function(k) {
            if (k.indexOf('000.5') != -1) {
                delete data.tables[comparison.tableID]['columns'][k];
            }
        })
        return data
    }
    
    comparison.prefixColumnNames = function(columns, suppressDenominator) {
        var prefixPieces = {},
            indentAdd = (!!suppressDenominator) ? 0 : 1;
        _.each(columns, function(v) {
            // update the dict of prefix names
            var prefixName = (v.name.slice(-1) == ':') ? v.name.slice(0, -1) : v.name;
            prefixPieces[v.indent] = prefixName;
            // compile to prefixed name
            v.prefixed_name = _.values(prefixPieces).slice(0, v.indent+indentAdd).join(': ');
        })
    }

    comparison.makeSumlevMap = function() {
        var sumlevSets = {};
        _.each(comparison.geoIDs, function(i) {
            var thisSumlev = i.slice(0, 3),
                thisName;
            sumlevSets[thisSumlev] = sumlevSets[thisSumlev] || {};
            sumlevSets[thisSumlev]['selections'] = sumlevSets[thisSumlev]['selections'] || [];
            
            if (i.indexOf('|') > -1) {
                var nameBits = i.split('|');
                thisName = comparison.capitalize(sumlevMap[nameBits[0]]['plural']) + ' in ' + comparison.data.geography[nameBits[1]]['name'];
            } else {
                thisName = comparison.data.geography[i]['name'];
            }
            sumlevSets[thisSumlev]['selections'].push({'name': thisName, 'geoID': i})
        });
        _.each(_.keys(comparison.data.data), function(i) {
            var thisSumlev = i.slice(0, 3);
            sumlevSets[thisSumlev]['count'] = sumlevSets[thisSumlev]['count'] || 0;
            sumlevSets[thisSumlev]['count'] += 1;
        });
        _.each(_.keys(sumlevSets), function(i) {
            sumlevSets[i]['name'] = sumlevMap[i];
        });
        
        return sumlevSets;
    }
    
    comparison.makeSortedSumlevMap = function(sumlevSets) {
        sumlevSets = _.map(sumlevSets, function(v, k) {
            return {
                sumlev: k,
                name: v.name,
                count: v.count,
                geoIDs: v.geoIDs
            }
        }).sort(comparison.sortDataBy('-count'));

        return sumlevSets;
    }

    comparison.capitalize = function(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    comparison.calcMedian = function(values) {
        values.sort( function(a, b) { return a - b; });
        var half = Math.floor(values.length / 2);

        if (values.length % 2) {
            return values[half];
        } else {
            return Math.round(((values[half-1] + values[half]) / 2.0) * 100) / 100;
        }
    }

    comparison.trackEvent = function(category, action, label) {
        // e.g. comparison.trackEvent('Comparisons', 'Add geographies', sumlev);
        // make sure we have Google Analytics function available
        if (typeof(ga) == 'function') {
            ga('send', 'event', category, action, label);
        }
    }

    // ready, set, go
    comparison.init(options);
    return comparison;
}
