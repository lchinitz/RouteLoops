var map,RoutingControl;
var rlPath,rawPath,guidepointPath;
var allPoints;
var currentWaypoints=[];
var doRemoval = false;
var directionMarkers = [];
const { protocol, hostname, port } = window.location;

async function initMap()
{
    const width = window.innerWidth;
    const height = window.innerHeight;
    var announcementURL = `http://${hostname}:${port}/announcement.html`;
    window.open(announcementURL,"A RouteLoops Announcement",`height=${height*0.95},width=${width*0.60},left=300,menubar=no,location=no,status=no,titlebar=no,top=100`);

    map = L.map('map').setView([42.3, -71.3], 8);

    map.on('click', function(event) {
	//alert(event.latlng);
	var lat = event.latlng.lat;
	var lng = event.latlng.lng;
	if (doRemoval) doRemoveWaypoint(lat,lng);	
    });    
    
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
	maxZoom: 18,
	attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    var theMode       = document.getElementById("inputMode").value;
    RoutingControl = L.Routing.control({
	waypoints:[],
	lineOptions: {styles: [{color: 'black', opacity: 1, weight: 5}]},
	router: new L.Routing.OSRMv1({
            "profile": `${theMode}`}),
    }).addTo(map);
    
    RoutingControl.on("routesfound", async (response) => {
	var theResponse = response;
	allPoints = [];
	for (const point of theResponse.routes[0].coordinates) allPoints.push({lat:point.lat,lng:point.lng});
	for (const item of  theResponse.routes[0].instructions) allPoints[item.index].instructions = item.text;
	//Based on the drag action, find the current set of waypoints.
	var newWaypoints = [];
	for (var i=1;i<theResponse.waypoints.length-1;i++){
	    var thisWaypoint = theResponse.waypoints[i];
	    newWaypoints.push({lat:thisWaypoint.latLng.lat, lng:thisWaypoint.latLng.lng});
	}
	currentWaypoints.length=0;
	for (const waypoint of newWaypoints) currentWaypoints.push(waypoint);
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var data = {allPoints:allPoints};
	var url = `http://${hostname}:${port}/modifyDirections`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	distDisplay = theJson.totalDistanceKm;
	allPoints.length = 0;
	for (const point of theJson.modifiedAllPoints) allPoints.push(point);
	var units = document.getElementById("inputUnits").value;
	if (units=="imperial") distDisplay = distDisplay*1000*100/2.54/12/5280;
	document.getElementById("outDist").innerHTML = distDisplay.toFixed(1);
	try{map.removeLayer(rlPath);}catch(err){}
	//Set markers at the locations where you have directions.
	for (const marker of directionMarkers) marker.map = null;
	directionMarkers.length=0;
	var countInstructions = 0;
	for (const point of allPoints){
	    if (point.hasOwnProperty("instructions")){
		countInstructions += 1;
		point.count = countInstructions;
		var marker = new L.Marker([point.lat, point.lng],{title:`${countInstructions}: ${point.instructions}`});
		marker.addTo(map);
		directionMarkers.push(marker);
	    }
	}
	showDirectionMarkers();	
    });
    
    
}
//--------------------------------------
function displayMarker(index){
    if (index<directionMarkers.length){
	var marker = directionMarkers[index];
	marker.addTo(map);
	index+=1;
	if (index<directionMarkers.length) setTimeout( ()=> {displayMarker(index)},200);
    }
    return;
}
//.......................................
function showDirectionMarkers(){
    if (document.getElementById("directionMarkers").checked){
	//for (const marker of directionMarkers) marker.addTo(map);
	displayMarker(0);
    }
    else{
	for (const marker of directionMarkers) map.removeLayer(marker);
    }
    return;
}

//.......................................
function lockRoute(){
    if (document.getElementById("lockRoute").checked){
	RoutingControl["_line"].options.addWaypoints = false;
	RoutingControl["_line"].options.extendToWaypoints = false;
    }
    else{
	RoutingControl["_line"].options.addWaypoints = true;
	RoutingControl["_line"].options.extendToWaypoints = true;
    }
    return;
}
//........................................................................................
async function doRL(waypointsIn)
{

    //Clear any paths on the map if there are any.
    try{map.removeLayer(rlPath);}catch(err){}
    try{map.removeLayer(rawPath);}catch(err){}
    try{map.removeLayer(guidepointPath);}catch(err){}
    
    //Find the starting point of the RouteLoop
    var theLocation = document.getElementById("inputLocation").value;
    var encoded = encodeURI(theLocation);

    //Geocode this starting location in to a Lat/Lng pair.
    var url = `http://${hostname}:${port}/geocode?location=${encoded}`;
    var theResp = await fetch(url);
    var theJson = await theResp.json();    
    var theLatLng = {lat:theJson.features[0].geometry.coordinates[1],lng:theJson.features[0].geometry.coordinates[0]};

    //Center the map on this location.
    if (typeof waypointsIn == "undefined")
	map.setView(new L.LatLng(theLatLng.lat,theLatLng.lng),18);

    var initialWaypoints = [];
    if (typeof waypointsIn == "undefined"){    
	//Generate points for the route.  These are the guide points generated by some method.
	var theDistance = document.getElementById("inputDist").value;
	var theUnits    = document.getElementById("inputUnits").value;
	var theRotation  = document.getElementById("inputRotation").value;
	var theDirection= document.getElementById("inputDirection").value;    
	var url = `http://${hostname}:${port}/getRLpoints?lat=${theLatLng.lat}&lng=${theLatLng.lng}`;
	url += `&dist=${theDistance}&units=${theUnits}&rotation=${theRotation}&direction=${theDirection}`;
	var theMethod= document.getElementById("method").value;    
	url += `&method=${theMethod}`;
	var theResp = await fetch(url);
	var theJson = await theResp.json();
	var initialWaypoints = JSON.parse(JSON.stringify(theJson));    
    }
    else{
	initialWaypoints = waypointsIn; 
    }
    //Add the starting location as both the first, and the last, guide point.
    var guidePoints = [];
    guidePoints.push(new L.LatLng(theLatLng.lat,theLatLng.lng));
    for (const waypoint of initialWaypoints) guidePoints.push(new L.LatLng(waypoint.lat,waypoint.lng));
    guidePoints.push(new L.LatLng(theLatLng.lat,theLatLng.lng));
    
    //Draw these guide points on the map.

    guidepointPath = new L.Polyline(guidePoints, {color:'blue',weight:2,opacity: 1.0,smoothFactor: 1});
    guidepointPath.addTo(map);    

    //Get a bounding box used to zoom the map to a more reasonable size.
    const RLBounds = guidepointPath.getBounds();
    if (typeof waypointsIn == "undefined")
	map.fitBounds(RLBounds);

    //Call the directions service using the guide point as waypoints.
    var theMode       = document.getElementById("inputMode").value;
    var inputHighways = document.getElementById("inputHighways").value;    
    var inputFerries  = document.getElementById("inputFerries").value;    
    var fitnessLevel  = document.getElementById("fitnessLevel").value;    
    var greenFactor   = document.getElementById("greenFactor").value;    
    var quietFactor   = document.getElementById("quietFactor").value;    
    var url = `http://${hostname}:${port}/directions?lat=${theLatLng.lat}&lng=${theLatLng.lng}`;
    url += `&mode=${theMode}&highways=${inputHighways}&ferries=${inputFerries}`;
    url += `&fitnessLevel=${fitnessLevel}&greenFactor=${greenFactor}&quietFactor=${quietFactor}`;    
    var waypointText= "";
    for (const waypoint of initialWaypoints) waypointText += `${waypoint.lat},${waypoint.lng}|`;
    waypointText = waypointText.slice(0,-1);
    url += `&waypoints=${waypointText}`;
    var theResp = await fetch(url);
    var theJson = await theResp.json();
    allPoints = theJson.features[0].allPoints;
    
    //Draw the raw result on the map.  This has not yet been cleaned up by RouteLoops.
    var rawPoints = [];
    for (const point of allPoints) rawPoints.push(new L.LatLng(point.lat,point.lng));
    rawPath = new L.Polyline(rawPoints,{color:'green',weight:2,opacity:1.0,smoothFactor:1});
    rawPath.addTo(map);
    
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
	var url = `http://${hostname}:${port}/cleanTails`;
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
	    var url = `http://${hostname}:${port}/directions?lat=${theLatLng.lat}&lng=${theLatLng.lng}`;
	    url += `&mode=${theMode}&highways=${inputHighways}&ferries=${inputFerries}`;
	    var waypointText= "";
	    for (const waypoint of waypoints) waypointText += `${waypoint.lat},${waypoint.lng}|`;
	    waypointText = waypointText.slice(0,-1);
	    url += `&waypoints=${waypointText}`;
	    var theResp = await fetch(url);
	    var directionsJson = await theResp.json();
	    allPoints = directionsJson.features[0].allPoints;	    
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
    var rlPoints = [];
    for (const point of allPoints) rlPoints.push(new L.LatLng(point.lat,point.lng));
    rlPath = new L.Polyline(rlPoints,{color:'red',weight:3,opacity:1.0,smoothFactor:1});
    rlPath.addTo(map);

    //Remove the other lines if that's desired.
    var yes = confirm("Remove other lines?");
    if (yes){
	map.removeLayer(rawPath);
	map.removeLayer(guidepointPath);
    }

    currentWaypoints = JSON.parse(JSON.stringify(waypoints));    

    //This is a special section for OSM, to enable draggable routes.
    var wpts = [];
    wpts.push(new L.LatLng(theLatLng.lat,theLatLng.lng))    
    for (const waypoint of waypoints)wpts.push(new L.LatLng(waypoint.lat,waypoint.lng))    
    wpts.push(new L.LatLng(theLatLng.lat,theLatLng.lng))    
    RoutingControl.setWaypoints(wpts);
        
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
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var data = {allPoints:allPoints,units:units,speed:speed};
	var url = `http://${hostname}:${port}/showDirections`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();	
	doPrint = confirm("Print it?");
	doShow = true;
    }

    if (theType=="sparseGPX"){
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var data = {allPoints:allPoints};
	var url = `http://${hostname}:${port}/makeSparseGPX`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	doPrint = true;
    }
    
    if (theType=="denseGPX"){
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var speed = prompt(`Your average ${mode} speed in ${pace}.`,paceDefault)
	if (pace.indexOf("minutes-per")>=0) speed = 60/speed;
	var data = {allPoints:allPoints,units:units,speed:speed};
	var url = `http://${hostname}:${port}/makeDenseGPX`;
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
	var url = `http://${hostname}:${port}/makeTCX`;
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

//..................................................................
function reverseRoute(){
    if (currentWaypoints.length==0) return;
    else{
	currentWaypoints.reverse();
	if (document.getElementById("inputRotation").value == "clockwise") document.getElementById("inputRotation").value = "counterclockwise"
	else                                                               document.getElementById("inputRotation").value = "clockwise"
	doRL(currentWaypoints);
	return;
    }
}
//..................................................................
function removeWaypoint(){
    if (currentWaypoints.length==0) return;
    else{
	doRemoval = true;
	alert('Click on the route on, or near, the waypoint you want to remove.');
	return;
    }
}
//................................................................
async function doRemoveWaypoint(lat,lng){
    
    var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};
    var data = {lat:lat,lng:lng,waypoints:currentWaypoints};
    var url = `http://${hostname}:${port}/removeWaypoint`;
    var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
    var theJson = await theResp.json();
    doRemoval = false;

    currentWaypoints = JSON.parse(JSON.stringify(theJson.modifiedWaypoints));
    doRL(currentWaypoints);

    return;
}
