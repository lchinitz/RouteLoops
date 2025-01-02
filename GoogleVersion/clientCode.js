var map,directionsService,directionsRenderer;
var rlPath,rawPath,guidepointPath;
var allPoints;
var directionMarkers = [];

async function initMap()
{

    const { Map } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary(
	"marker",
    )
    
    map = new Map(document.getElementById('map'), {
        center: {lat: 42.3, lng: -71.3},
        zoom: 8,
	mapId: "DemoMap"
    });

    const infoWindow = new google.maps.InfoWindow({
	content: null
    });


    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({draggable:true,map});
    directionsRenderer.setMap(map);
    directionsRenderer.addListener("directions_changed", async () => {
	const directions = directionsRenderer.getDirections();
	if (directions) {
	    var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	    var data = {directions:directions};
	    var url = `http://localhost:8080/modifyDirections`;
	    var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	    var theJson = await theResp.json();
	    var distDisplay = theJson.modifiedDirections.routes[0].totalDistanceKm;
	    var units = document.getElementById("inputUnits").value;
	    if (units=="imperial") distDisplay = distDisplay*1000*100/2.54/12/5280;
	    document.getElementById("outDist").innerHTML = distDisplay.toFixed(1);
	    allPoints = theJson.modifiedDirections.routes[0].allPoints;
	    for (const marker of directionMarkers) marker.map = null;
	    directionMarkers.length=0;
	    var countInstructions = 0;
	    for (const point of allPoints){
		if (point.hasOwnProperty("instructions")){
		    countInstructions += 1;
		    point.count = countInstructions;
		    var marker = new AdvancedMarkerElement({
			position: {lat:point.lat,lng:point.lng},
			map: map,
			title: `${point.count}: ${point.instructions}`,
			//content: `${point.count}: ${point.instructions}`
		    });
		    directionMarkers.push(marker);
		}
	    }
	    showDirectionMarkers();
	    try{rlPath.setMap(null);}catch(err){}
	}
    });
    
}
//.......................................
function showDirectionMarkers(){
    if (document.getElementById("directionMarkers").checked){
	for (const marker of directionMarkers) marker.map = map;
    }
    else{
	for (const marker of directionMarkers) marker.map = null;
    }
    return;
}

//.......................................
function lockRoute(){
    if (document.getElementById("lockRoute").checked){
	directionsRenderer.setOptions({draggable:false});
    }
    else{
	directionsRenderer.setOptions({draggable:true});
    }
    return;
}
//........................................................................................
async function doRL()
{

    //Clear any paths on the map if there are any.
    try{rlPath.setMap(null);}catch(err){}
    try{rawPath.setMap(null);}catch(err){}
    try{guidepointPath.setMap(null);}catch(err){}
    
    //Find the starting point of the RouteLoop
    var theLocation = document.getElementById("inputLocation").value;
    var encoded = encodeURI(theLocation);

    //Geocode this starting location in to a Lat/Lng pair.
    var url = `http://localhost:8080/geocode?location=${encoded}`;
    var theResp = await fetch(url);
    var theJson = await theResp.json();
    var theLatLng = theJson.results[0].geometry.location;

    //Center the map on this location.
    map.setCenter(theLatLng);

    //Generate points for the route.  These are the guide points generated by some method.
    var theDistance = document.getElementById("inputDist").value;
    var theUnits    = document.getElementById("inputUnits").value;
    var theRotation  = document.getElementById("inputRotation").value;
    var theDirection= document.getElementById("inputDirection").value;    
    var url = `http://localhost:8080/getRLpoints?lat=${theLatLng.lat}&lng=${theLatLng.lng}`;
    url += `&dist=${theDistance}&units=${theUnits}&rotation=${theRotation}&direction=${theDirection}`;
    var theMethod= document.getElementById("method").value;    
    url += `&method=${theMethod}`;
    var theResp = await fetch(url);
    var theJson = await theResp.json();
    var initialWaypoints = JSON.parse(JSON.stringify(theJson));    
    //Add the starting location as both the first, and the last, guide point.
    var guidePoints = JSON.parse(JSON.stringify(initialWaypoints));
    guidePoints.unshift(theLatLng);
    guidePoints.push(theLatLng);
    
    //Draw these guide points on the map.
    guidepointPath = new google.maps.Polyline({path:guidePoints,geodesic:true,strokeColor: "blue",strokeOpacity: 1.0,strokeWeight:2});
    guidepointPath.setMap(map);

    //Get a bounding box used to zoom the map to a more reasonable size.
    const RLBounds = new google.maps.LatLngBounds();
    for (const location of guidePoints) RLBounds.extend(location);
    map.fitBounds(RLBounds);

    //Call the directions service using the guide point as waypoints.
    var theMode       = document.getElementById("inputMode").value;
    var inputHighways = document.getElementById("inputHighways").value;    
    var inputFerries  = document.getElementById("inputFerries").value;    
    var url = `http://localhost:8080/directions?lat=${theLatLng.lat}&lng=${theLatLng.lng}`;
    url += `&mode=${theMode}&highways=${inputHighways}&ferries=${inputFerries}`;
    var waypointText= "";
    for (const waypoint of initialWaypoints) waypointText += `${waypoint.lat},${waypoint.lng}|`;
    waypointText = waypointText.slice(0,-1);
    url += `&waypoints=${waypointText}`;
    var theResp = await fetch(url);
    var theJson = await theResp.json();
    allPoints = theJson.routes[0].allPoints;
    
    //Draw the raw result on the map.  This has not yet been cleaned up by RouteLoops.
    rawPath = new google.maps.Polyline({path: allPoints,geodesic: true,strokeColor: "green",strokeOpacity: 1.0,strokeWeight: 2});
    rawPath.setMap(map);
    
    //Call a cleaning function until the result stabilizes
    var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};
    var keepGoing = true;
    var countCalcs = 0;
    var waypoints = [];
    for (const waypoint of initialWaypoints) waypoints.push(waypoint);
    lastCounts = {cleaned:-1,total:-1};
    while (keepGoing){
	countCalcs += 1;

	//Take allPoints and clean up the path.
	var data = {LLs:allPoints};
	var url = `http://localhost:8080/cleanTails`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var cleanTailsJson = await theResp.json();

	if (cleanTailsJson.cleanedUp > 0){ //You modified the path, so redo the whole thing with this modified path.
	    //Generate the new set of allPoints.
	    allPoints.length = 0;
	    for (const point of cleanTailsJson.newPath) allPoints.push(point);

	    //Based on the new allPoints, find the current set of waypoints.  Choose the closest points to the previous waypoints.
	    newWaypoints = [];
	    for (const waypoint of waypoints){
		var closest = null;
		for (const point of allPoints){
		    var separation = Math.pow((waypoint.lat-point.lat),2) + Math.pow((waypoint.lng-point.lng),2)
		    if (closest==null) closest = {point:point,separation:separation};
		    if (separation < closest.separation) closest = {point:point,separation:separation};
		}
		newWaypoints.push(closest.point);
	    }
	    waypoints.length=0;
	    for (const waypoint of newWaypoints) waypoints.push(waypoint);

	    //Generate a new path based on this new set of waypoints.
	    var url = `http://localhost:8080/directions?lat=${theLatLng.lat}&lng=${theLatLng.lng}`;
	    url += `&mode=${theMode}&highways=${inputHighways}&ferries=${inputFerries}`;
	    var waypointText= "";
	    for (const waypoint of waypoints) waypointText += `${waypoint.lat},${waypoint.lng}|`;
	    waypointText = waypointText.slice(0,-1);
	    url += `&waypoints=${waypointText}`;
	    var theResp = await fetch(url);
	    var directionsJson = await theResp.json();
	    allPoints = directionsJson.routes[0].allPoints;	    
	}
	
	else{ //No change, so that's it.
	    keepGoing = false;
	}
		
	if (cleanTailsJson.cleanedUp==lastCounts.cleaned && allPoints.length==lastCounts.total){ //The modifications are not changing, so stop
	    keepGoing = false;
	}
	else{
	    lastCounts = {cleaned:cleanTailsJson.cleanedUp,total:allPoints.length};
	}

    }

    
    var distDisplay = cleanTailsJson.distKm;
    var units = document.getElementById("inputUnits").value;
    if (units=="imperial") distDisplay = distDisplay*1000*100/2.54/12/5280;
    document.getElementById("outDist").innerHTML = distDisplay.toFixed(1);
    document.getElementById('calcs').innerHTML = countCalcs;    

            
    //Draw the cleaned result on the map.
    rlPath = new google.maps.Polyline({path:allPoints,geodesic: true,strokeColor: "green",strokeOpacity: 1.0,strokeWeight: 3});
    rlPath.setMap(map);

    //Remove the other lines if that's desired.
    var yes = confirm("Remove other lines?");
    if (yes){
	rawPath.setMap(null);
	guidepointPath.setMap(null);
    }

    //This is a special section for Google Maps, to enable draggable routes.
    var theWaypoints = [];
    for (const waypoint of waypoints) theWaypoints.push({location:new google.maps.LatLng(waypoint.lat,waypoint.lng), stopover:false});

    var theRequest = {origin:     {lat:theLatLng.lat,lng:theLatLng.lng},
		      destination:{lat:theLatLng.lat,lng:theLatLng.lng},
		      travelMode: document.getElementById("inputMode").value.toUpperCase(),
		      waypoints: theWaypoints
		     };

    directionsService.route(theRequest, function(response, status) {
	if (status == "OK") {
	    //var warnings = document.getElementById("warnings_panel");
	    //warnings.innerHTML = "" + response.routes[0].warnings + "";
	    directionsRenderer.setDirections(response);
	    //showSteps(response);
	}
    });
        
    return;
}

//......................................................................................................
async function generateOutput()
{
    var theType = document.getElementById("createOutput").value;
    if (theType=="none") return;

    var routeName = document.getElementById("routeName").value.trim();
    var units = document.getElementById("inputUnits").value;
    var mode = document.getElementById("inputMode").value;
    var advanceUnits = "meters";
    var pace = "kph";
    var paceDefault = 25;
    if (mode=="walking") {
	pace = "minutes-per-kilometer";
	paceDefault = 6;  //min per km
    }
    if (units=="imperial"){
	advanceUnits = "feet";
	pace = "mph"
	paceDefault = 16;
	if (mode=="walking"){
	    pace = "minutes-per-mile";
	    packetDefault = 10; //min per mile
	}
    }

    var doPrint = false;
    var doShow = false;
    
    if (theType=="directions"){
	var speed = prompt(`Your average ${mode} speed in ${pace}.`,paceDefault)
	if (pace.indexOf("minutes-per")>=0) speed = 60/speed;
	const directions = directionsRenderer.getDirections();
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	//var data = {directions:directions};
	var data = {allPoints:allPoints,units:units,speed:speed};
	var url = `http://localhost:8080/showDirections`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();	
	doPrint = confirm("Print it?");
	doShow = true;
    }

    if (theType=="sparseGPX"){
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var data = {allPoints:allPoints};
	var url = `http://localhost:8080/makeSparseGPX`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	doPrint = true;
    }
    
    if (theType=="denseGPX"){
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var speed = prompt(`Your average ${mode} speed in ${pace}.`,paceDefault)
	if (pace.indexOf("minutes-per")>=0) speed = 60/speed;
	var data = {allPoints:allPoints,units:units,speed:speed};
	var url = `http://localhost:8080/makeDenseGPX`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	doPrint = true;
    }
    
    if (theType=="tcx"){
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var speed = prompt(`Your average ${mode} speed in ${pace}.`,paceDefault)
	if (pace.indexOf("minutes-per")>=0) speed = 60/speed;
	var advance = prompt(`Set turn warnings this many ${advanceUnits} in advance.`,300);
	var data = {allPoints:allPoints,units:units,speed:speed,advance:advance,name:routeName};
	var url = `http://localhost:8080/makeTCX`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	doPrint = true;
    }
    

    if (theJson.status=="OK"){

	var theInfo = "";
	var theType = "";
	if (theJson.hasOwnProperty("html")){
	    theInfo = theJson.html;
	    theType = "html";
	}
	if (theJson.hasOwnProperty("gpx")){
	    theInfo = theJson.gpx;
	    theType = "gpx";
	}
	if (theJson.hasOwnProperty("tcx")){
	    theInfo = theJson.tcx;
	    theType = "tcx";
	}
	
	if (doShow){
	    const winUrl = URL.createObjectURL(
		new Blob([theInfo], { type: "text/html" })
	    );

	    const win = window.open(
		winUrl,
		"win",
		`width=800,height=400,screenX=200,screenY=200`
	    );
	}

	if (doPrint){
	    var useName = theJson.name;
	    if (routeName.length>0) useName = routeName;
	    var blob = new Blob([theInfo], {type: "text/html"});
	    saveAs(blob, `${useName}.${theType}`);
	}
    }


    document.getElementById("createOutput").value = "none";
    return;
}

