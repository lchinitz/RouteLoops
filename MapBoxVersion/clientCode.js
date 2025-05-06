// Be sure to include a valid accessToken
//Also, adjust the callback.
//Adjust all DoNotPush

var map,RoutingControl;
var rlPath,rawPath,guidepointPath;
var allPoints;
var currentWaypoints=[];
var doRemoval = false;
var doAdd = false;
var directionMarkers = [], waypointMarkers = [];
var homeMarker;
const { protocol, hostname, port } = window.location;
const urlParams = new URLSearchParams(window.location.search);
var accessToken = null;
var oauthToken = null;
var isRedirectFromGarmin = false;
var hasRouteLink = false;
var garminCallback;
var garminPulses = [];
var garminPulseIndex;
var theConfiguration = {};

async function initMap()
{
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    if (urlParams.has("oauth_token") && urlParams.has("oauth_verifier")) isRedirectFromGarmin=true;
    if (hostname.indexOf("localhost")>=0)
	garminCallback = `${protocol}//${hostname}:${port}/index.html`;
    else
	garminCallback = `${protocol}//${hostname}:${port}/receiveFromGarmin`;    

    if (urlParams.has("routeLink")) hasRouteLink = true;

    if (!isRedirectFromGarmin && !hasRouteLink){
	//var announcementURL = `${protocol}//${hostname}:${port}/announcement.html`;
	//window.open(announcementURL,"A RouteLoops Announcement",`height=${height*0.95},width=${width*0.60},left=300,menubar=no,location=no,status=no,titlebar=no,top=100`);
	var url = `${protocol}//${hostname}:${port}/readFile?fileName=announcement.html`;
	var theResp = await fetch(url);
	var theJson = await theResp.json();    
	var theHTML = theJson.contents;
	document.getElementById("innerAnnounce").innerHTML = theHTML;
	document.getElementById("announceDiv").style.height = `${height*0.95}px`;
	document.getElementById("announceDiv").style.width = `${width*0.60}px`;
	document.getElementById("announceDiv").style.left = `${300}px`;
	document.getElementById("announceDiv").style.top = `${50}px`;
    }
    else{
	closeAnnounce();
    }
   

    mapboxgl.accessToken = 'A valid token';
    map = new mapboxgl.Map({
        container: 'map', // container ID
        center: [-71.3, 42.3], // starting position [lng, lat]. Note that lat must be set between -90 and 90
        zoom: 9 // starting zoom
    });

    map.on('click', function(event) {
	//alert(event.lngLat);
	var lat = event.lngLat.lat;
	var lng = event.lngLat.lng;
	if (doRemoval) doRemoveWaypoint(lat,lng);	
	if (doAdd) doAddWaypoint(lat,lng);	
    });

    if (isRedirectFromGarmin){
	var oauth_token = urlParams.get("oauth_token");
	var oauth_verifier = urlParams.get("oauth_verifier");
	console.log(oauth_token);
	console.log(oauth_verifier);
	console.log(oauth_token=="null" || oauth_verifier=="null");
	if (oauth_token=="null" || oauth_verifier=="null"){
	    var comment = `Either the token (${oauth_token}) or the verifier (${oauth_verifier}) is null, so authentication to Garmin Connect did not succeed.\n`;
	    comment += `You can still create routes on RouteLoops, save them locally, and upload to Garmin Connect later when connectivity has been re-established.`;
	    alert(comment);
	}
	else{
	    connectToGarmin(3);
	}
    }

    if (hasRouteLink){
	useRouteLink();
    }    
    
    return;
    
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
	for (const marker of directionMarkers) marker.remove();
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
//.........................................
async function setAsHome()
{
    try{homeMarker.remove();}catch(err){}
    
    //Find the starting point of the RouteLoop
    var theLocation = document.getElementById("inputLocation").value;
    var areCoords = false;
    try{
	var items = theLocation.split(",");
	if (items[0].toLowerCase().indexOf("s")>=0) items[0] = ("-" + items[0]).replaceAll(" ","");
	if (items[1].toLowerCase().indexOf("w")>=0) items[1] = ("-" + items[1]).replaceAll(" ","");
	var lat = parseFloat(items[0]);
	var lng = parseFloat(items[1]);
	if (items.length==2 && !isNaN(items[0]) && !isNaN(items[1])) areCoords = true
	var theLatLng = {lat:lat,lng:lng};
    }
    catch(err){}

    if (!areCoords){
	var encoded = encodeURI(theLocation);

	//Geocode this starting location in to a Lat/Lng pair.
	var url = `${protocol}//${hostname}:${port}/geocode?location=${encoded}`;
	var theResp = await fetch(url);
	var theJson = await theResp.json();    
	var theLatLng = {lat:theJson.features[0].geometry.coordinates[1],lng:theJson.features[0].geometry.coordinates[0]};
    }

    //Center the map on this location.
    if (typeof waypointsIn == "undefined" && currentWaypoints.length==0)
	map.setCenter([theLatLng.lng,theLatLng.lat]);

    //Put a house marker at the start/end point.
    var el = document.createElement('div');
    el.className = 'marker';
    el.style.backgroundImage = `url(${protocol}//${hostname}:${port}/images/Home.png)`;
    el.style.width = '30px';
    el.style.height = '30px';

    homeMarker = new mapboxgl.Marker(el,{draggable:true})
	.setLngLat([theLatLng.lng,theLatLng.lat])
	.setPopup(new mapboxgl.Popup().setText(`${theLocation}`))
	.addTo(map);

    homeMarker.on("dragend", function(e) {
	var position = homeMarker.getLngLat();
	document.getElementById("inputLocation").value = `${position.lat},${position.lng}`;
	map.setCenter([position.lng,position.lat]);
    });
    return {theLocation,theLatLng};
}
//........................................................................................
async function doRL(waypointsIn)
{

    //Clear any paths on the map if there are any.
    if(map.getLayer('guidePointsFill')) map.removeLayer('guidePointsFill');
    if(map.getLayer('guidePointsLine')) map.removeLayer('guidePointsLine');
    try{map.removeSource('guidePoints');}catch(err){}
    if(map.getLayer('rawPointsFill')) map.removeLayer('rawPointsFill');
    if(map.getLayer('rawPointsLine')) map.removeLayer('rawPointsLine');
    try{map.removeSource('rawPoints');}catch(err){}
    if(map.getLayer('rlPointsFill')) map.removeLayer('rlPointsFill');
    if(map.getLayer('rlPointsLine')) map.removeLayer('rlPointsLine');
    try{map.removeSource('rlPoints');}catch(err){}
    try{homeMarker.remove()} catch(err){}

    var {theLocation,theLatLng} = await setAsHome();

    /*
    //Find the starting point of the RouteLoop
    var theLocation = document.getElementById("inputLocation").value;
    var encoded = encodeURI(theLocation);

    //Geocode this starting location in to a Lat/Lng pair.
    var url = `${protocol}//${hostname}:${port}/geocode?location=${encoded}`;
    var theResp = await fetch(url);
    var theJson = await theResp.json();    
    var theLatLng = {lat:theJson.features[0].geometry.coordinates[1],lng:theJson.features[0].geometry.coordinates[0]};

    //Center the map on this location.
    if (typeof waypointsIn == "undefined")
	map.setCenter([theLatLng.lng,theLatLng.lat]);
    
    //Put a house marker at the start/end point.
    var el = document.createElement('div');
    el.className = 'marker';
    el.style.backgroundImage = `url(${protocol}//${hostname}:${port}/images/Home.png)`;
    el.style.width = '30px';
    el.style.height = '30px';

    homeMarker = new mapboxgl.Marker(el,{draggable:true})
	.setLngLat([theLatLng.lng,theLatLng.lat])
	.setPopup(new mapboxgl.Popup().setText(`${theLocation}`))
	.addTo(map);
    */
    
    var initialWaypoints = [];
    if (typeof waypointsIn == "undefined"){
	//Generate points for the route.  These are the guide points generated by some method.
	var theDistance = document.getElementById("inputDist").value;
	var theUnits    = document.getElementById("inputUnits").value;
	var theRotation  = document.getElementById("inputRotation").value;
	var theDirection= document.getElementById("inputDirection").value;    
	var url = `${protocol}//${hostname}:${port}/getRLpoints?lat=${theLatLng.lat}&lng=${theLatLng.lng}`;
	url += `&dist=${theDistance}&units=${theUnits}&rotation=${theRotation}&direction=${theDirection}`;
	var theMethod= document.getElementById("method").value;    
	url += `&method=${theMethod}`;
	var theResp = await fetch(url);
	var theJson = await theResp.json();
	initialWaypoints = JSON.parse(JSON.stringify(theJson));    
    }
    else{
	initialWaypoints = waypointsIn; 
    }
    //Add the starting location as both the first, and the last, guide point.
    var guidePoints = [];
    guidePoints.push([theLatLng.lng,theLatLng.lat]);
    for (const waypoint of initialWaypoints) guidePoints.push([waypoint.lng,waypoint.lat]);
    guidePoints.push([theLatLng.lng,theLatLng.lat]);

    //Strange issue with style not finished loading.  Take a brief pause to fix it.
    function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
    }
    await sleep(1000);

    map.addSource('guidePoints',{
	type:'geojson',
	data:{
	    type: 'Feature',
	    geometry:{
		type:'Polygon',
		coordinates:[guidePoints]
	    }
	}
    });
    map.addLayer({id:'guidePointsFill',type:'fill',source:'guidePoints',layout:{},paint:{'fill-color':'green','fill-opacity':0.5}});
    map.addLayer({id:'guidePointsLine',type:'line',source:'guidePoints',layout:{},paint:{'line-color':'green','line-width':2}});

    //Get a bounding box used to zoom the map to a more reasonable size.
    try{
	if (typeof waypointsIn == "undefined")
	    map.fitBounds(guidePoints,{padding:{top:10,bottom:10,left:10,rights:10}});
    }
    catch(err){}

    //Call the directions service using the guide point as waypoints.
    var theMode       = document.getElementById("inputMode").value;
    var inputHighways = document.getElementById("inputHighways").value;    
    var inputFerries  = document.getElementById("inputFerries").value;    
    var url = `${protocol}//${hostname}:${port}/directions?lat=${theLatLng.lat}&lng=${theLatLng.lng}`;
    url += `&mode=${theMode}`;
    url += `&highways=${inputHighways}&ferries=${inputFerries}`;
    var waypointText= "";
    for (const waypoint of initialWaypoints) waypointText += `${waypoint.lat},${waypoint.lng}|`;
    waypointText = waypointText.slice(0,-1);
    url += `&waypoints=${waypointText}`;
    var theResp = await fetch(url);
    var theJson = await theResp.json();
    allPoints = theJson.routes[0].allPoints;
    
    //Draw the raw result on the map.  This has not yet been cleaned up by RouteLoops.
    var rawPoints = [];
    for (const point of allPoints) rawPoints.push([point.lng,point.lat]);

    map.addSource('rawPoints',{
	type:'geojson',
	data:{
	    type: 'Feature',
	    geometry:{
		type:'Polygon',
		coordinates:[rawPoints]
	    }
	}
    });
    map.addLayer({id:'rawPointsFill',type:'fill',source:'rawPoints',layout:{},paint:{'fill-color':'blue','fill-opacity':0.5}});
    map.addLayer({id:'rawPointsLine',type:'line',source:'rawPoints',layout:{},paint:{'line-color':'blue','line-width':2}});

    var cleanTailsJson = {cleanedUp:0,distKm:allPoints[allPoints.length-1].cumulativeDistanceKm,newPath:allPoints};
    
    //Call a cleaning function until the result stabilizes
    var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};
    var keepGoing = true;
    if (hasRouteLink) {
	keepGoing = false;
	hasRouteLink = false; //Reset this so that from now on it will perform the route cleaning
    }
    var countCalcs = 0;
    var waypoints = [];
    for (const waypoint of initialWaypoints) waypoints.push(waypoint);
    lastCounts = {cleaned:-1,total:-1};
    while (keepGoing){
	countCalcs += 1;

	//Take allPoints and clean up the path.
	var data = {LLs:allPoints};
	var url = `${protocol}//${hostname}:${port}/cleanTails`;
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
	    var url = `${protocol}//${hostname}:${port}/directions?lat=${theLatLng.lat}&lng=${theLatLng.lng}`;
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
    distDisplay = allPoints[allPoints.length-1].cumulativeDistanceKm;
    var units = document.getElementById("inputUnits").value;
    if (units=="imperial") distDisplay = distDisplay*1000*100/2.54/12/5280;
    document.getElementById("outDist").innerHTML = distDisplay.toFixed(1);
    document.getElementById('calcs').innerHTML = countCalcs;    
            
    //Draw the cleaned result on the map.
    var rlPoints = [];
    for (const point of allPoints) rlPoints.push([point.lng,point.lat]);

    map.addSource('rlPoints',{
	type:'geojson',
	data:{
	    type: 'Feature',
	    geometry:{
		type:'Polygon',
		coordinates:[rlPoints]
	    }
	}
    });
    //map.addLayer({id:'rlPointsFill',type:'fill',source:'rlPoints',layout:{},paint:{'fill-color':'red','fill-opacity':0.5}});
    map.addLayer({id:'rlPointsLine',type:'line',source:'rlPoints',layout:{},paint:{'line-color':'red','line-width':2}});

    //Also, direction markers.
    for (const marker of directionMarkers) marker.remove();
    directionMarkers.length=0;
    var theIndex = 0;
    for (const point of allPoints){
	if (!point.hasOwnProperty("instructions"))continue;
	theIndex += 1;
	var theColor = "#3FB1CE";	
	if (theIndex == 1) theColor = "red";
	var marker = new mapboxgl.Marker({color:theColor})
	    .setLngLat([point.lng,point.lat])
	    .setPopup(new mapboxgl.Popup().setText(`${theIndex}: ${point.instructions}`))
	if (document.getElementById("directionMarkers").checked) marker.addTo(map);
	directionMarkers.push(marker)
    }
    
    //Remove the other lines if that's desired.
    //var yes = confirm("Remove other lines?");
    var yes = true;
    if (yes){
	map.removeLayer('guidePointsFill');
	map.removeLayer('guidePointsLine');
	map.removeSource('guidePoints');
	map.removeLayer('rawPointsFill');
	map.removeLayer('rawPointsLine');
	map.removeSource('rawPoints');
    }

    currentWaypoints = JSON.parse(JSON.stringify(waypoints));    

    //Also, waypoint markers
    for (const marker of waypointMarkers) marker.remove();
    waypointMarkers.length=0;
    var theIndex = 0;
    for (const point of currentWaypoints){
	var theColor = "green";	
	var marker = new mapboxgl.Marker({color:theColor,draggable:true})
	    .setLngLat([point.lng,point.lat])
	    .setPopup(new mapboxgl.Popup().setText(`Waypoint _${theIndex}_`))
	marker.on('dragend', onMarkerDragEnd);
	marker.addTo(map);
	waypointMarkers.push(marker)
	theIndex += 1;
    }
    
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
	var url = `${protocol}//${hostname}:${port}/showDirections`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();	
	doPrint = confirm("Print it?");
	doShow = true;
    }

    if (theType=="sparseGPX"){
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var data = {allPoints:allPoints};
	var url = `${protocol}//${hostname}:${port}/makeSparseGPX`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	doPrint = true;
    }
    
    if (theType=="denseGPX"){
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var speed = prompt(`Your average ${mode} speed in ${pace}.`,paceDefault)
	if (pace.indexOf("minutes-per")>=0) speed = 60/speed;
	var data = {allPoints:allPoints,units:units,speed:speed};
	var url = `${protocol}//${hostname}:${port}/makeDenseGPX`;
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
	var url = `${protocol}//${hostname}:${port}/makeTCX`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	doPrint = true;
    }

    if (theType=="garmin"){
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	    
	var data = {allPoints:allPoints,name:routeName};
	var url = `${protocol}//${hostname}:${port}/makeGarmin`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	doPrint = false;
	//Do the upload to Garmin Connect
	var url = `${protocol}//${hostname}:${port}/uploadToGarmin`;
	body = {route:theJson.json,token:oauthToken};
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(body),headers:ApiHeaders});
	var theJson = await theResp.json();
	if (theJson.status=="OK"){
	    alert(theJson.message);
	}
	else if (theJson.status=="NG" && theJson.message.indexOf("No secret")>=0){
	    var feedback = "The upload to Garmin Connect has failed.  This RouteLoops session has not yet been connected to Garmin Connect.  Would you like to do that?";
	    var answer = confirm(feedback);
	    if (answer) connectToGarmin();
	    else {
		var suggestion = "OK.  You can still save routes as GPX or TCX, and upload them directly to Garmin Connect at a later time.";
		alert(suggestion);
	    }
	}
	else if(theJson.status=="NG"){
	    alert(`The upload to Garmin Connect has failed with message "${theJson.message}". You might try reconnecting this session to Garmin Connect.`);
	}
    }

    if (theType=="google"){
	doPrint = false;
	var start = `${allPoints[0].lat},${allPoints[0].lng}`;
	var destination = `${allPoints[0].lat},${allPoints[0].lng}`;
	var waypoints = "";
	for (const waypoint of currentWaypoints) waypoints += `${waypoint.lat},${waypoint.lng}|`;
	waypoints = waypoints.slice(0,-1);
	var inputMode = document.getElementById("inputMode").value;
	var travelmode = "bicycling";
	if (inputMode.indexOf("driving")>=0) travelmode = "driving";
	if (inputMode.indexOf("foot")>=0) travelmode = "walking";
	const url = `https://www.google.com/maps/dir/?api=1&origin=${start}&destination=${destination}&waypoints=${waypoints}&dir_action=navigate&travelmode=${travelmode}`;
	alert(`This will open a new window with the "anchor" points displayed on Google Maps.  Google will do its own routing, which is very likely NOT going to be the same as the RouteLoops routing.`);
	window.open(url,'_blank');
	var theJson = {status:"google"};
    }
    
    if (theType=="link"){
	saveConfiguration();
	doPrint = false;
	var theJson = {status:"link"};
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
async function disconnectFromGarmin()
{
    //Disconnect this session from Garmin Connect
    var url = `${protocol}//${hostname}:${port}/uploadToGarmin`;
    body = {route:null,token:oauthToken};
    var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};	
    var theResp = await fetch(url,{method:'POST',body:JSON.stringify(body),headers:ApiHeaders});
    var theJson = await theResp.json();
    if (theJson.status=="OK"){
	alert(theJson.message);
    }
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
    var url = `${protocol}//${hostname}:${port}/removeWaypoint`;
    var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
    var theJson = await theResp.json();
    doRemoval = false;

    currentWaypoints = JSON.parse(JSON.stringify(theJson.modifiedWaypoints));
    doRL(currentWaypoints);

    return;
}

//.............................................................
function onMarkerDragEnd(event){

    const marker = event.target;
    const lngLat = marker.getLngLat();
    //alert(lngLat);
    const popUp = marker.getPopup();
    const text = popUp["_content"].textContent;
    const split = text.split("_");
    const wpnum = split[1];
    //alert(wpnum);

    //Move this waypoint to the dragged location.
    currentWaypoints[wpnum] = {lat:lngLat.lat, lng:lngLat.lng};
    doRL(currentWaypoints);
    
    return;
}

//..................................................................
function addWaypoint(){
    if (allPoints.length==0) return;
    else{
	doAdd = true;
	alert('Click on the route on, or near, the location where you want a new waypoint.');
	return;
    }
}
//................................................................
async function doAddWaypoint(lat,lng){
    
    var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};
    var data = {lat:lat,lng:lng,waypoints:currentWaypoints,allPoints:allPoints};
    var url = `${protocol}//${hostname}:${port}/addWaypoint`;
    var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
    var theJson = await theResp.json();
    doAdd = false;

    currentWaypoints = JSON.parse(JSON.stringify(theJson.modifiedWaypoints));
    doRL(currentWaypoints);

    return;
}

//...........................
async function connectToGarmin(step)
{
    if (step!=3){
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};
	var data = {};
	var url = `${protocol}//${hostname}:${port}/garminRequestToken`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	console.log(theJson);
	if (theJson.hasOwnProperty("token")) oauthToken = theJson.token;
	
	//Direct the user to log in to Garmin
	var url = `https://connect.garmin.com/oauthConfirm?oauth_token=${theJson.token}&oauth_callback=${encodeURIComponent(garminCallback)}`;	
	window.open(url,"_blank");
    }

    else if (step==3){
	//alert(urlParams);
	oauth_token = urlParams.get("oauth_token");
	oauth_verifier = urlParams.get("oauth_verifier");
	oauthToken = oauth_token;
	var ApiHeaders =  {'Accept': 'application/json','Content-Type': 'application/json'};
	var data = {oauth_token:oauth_token,oauth_verifier:oauth_verifier};
	var url = `${protocol}//${hostname}:${port}/garminRequestAccess`;
	var theResp = await fetch(url,{method:'POST',body:JSON.stringify(data),headers:ApiHeaders});
	var theJson = await theResp.json();
	console.log(theJson);
	accessToken = theJson.token;
	if (theJson.status=="OK")alert(`Connection to Garmin Connect established.  Once you have created a route, you can send it to Garmin Connect using the option in the "Output" menu.`);
	else alert(`Connection to Garmin Connect failed.  You may want to try this again.`);
    }
    
    
    return;
}

//..........................................................
function askAboutGarmin()
{
    if (isRedirectFromGarmin || hasRouteLink) return;
    else{
	var comment = "Would you like to log into Garmin before you create any routes, to facilitate easy uploads of routes to Garmin Connect?";
	var answer = confirm(comment);
	if (answer) connectToGarmin();
	else {
	    var suggestion = "OK.  You can still save routes locally as GPX or TCX, and upload them directly to Garmin Connect at a later time.";
	    suggestion += "\n If you want to connect later, tap the Garmin/RouteLoops icon at the bottom of the page.";
	    alert(suggestion);
	    var theWidth = document.getElementById("yinYang").width;
	    var theHeight = document.getElementById("yinYang").height;
	    garminPulses.push({width:theWidth,height:theHeight});
	    garminPulses.push({width:theWidth*2,height:theHeight*2});
	    for (var i=0;i<3;i++){
		garminPulses.push(garminPulses[0]);
		garminPulses.push(garminPulses[1]);
	    }
	    garminPulses.push(garminPulses[0]);
	    garminPulseIndex = 0;
	    pulseImage();
	}
	return;
    }
}
//............................................................
function pulseImage(){
    
    setTimeout(function(){
	document.getElementById("yinYang").width  = garminPulses[garminPulseIndex].width;
	document.getElementById("yinYang").height = garminPulses[garminPulseIndex].height;
	garminPulseIndex += 1;
	if (garminPulseIndex<garminPulses.length) pulseImage();
    },500);

    return;

}

//............................................................
function saveConfiguration(){

    theConfiguration = {};
    theConfiguration.inputLocation = document.getElementById("inputLocation").value;
    theConfiguration.inputDist = document.getElementById("inputDist").value;
    theConfiguration.inputUnits = document.getElementById("inputUnits").value;
    theConfiguration.inputMode = document.getElementById("inputMode").value;
    theConfiguration.inputRotation = document.getElementById("inputRotation").value;
    theConfiguration.inputDirection = document.getElementById("inputDirection").value;
    theConfiguration.method = document.getElementById("method").value;
    theConfiguration.inputHighways = document.getElementById("inputHighways").value;
    theConfiguration.inputFerries = document.getElementById("inputFerries").value;
    theConfiguration.currentWaypoints = currentWaypoints;

    var theLink = "";
    theLink = `${protocol}//${hostname}:${port}/index.html`;
    theLink += "?routeLink=true";
    for (const item in theConfiguration){
	if (item != "currentWaypoints") theLink += `&${item}=${theConfiguration[item]}`;
    }
    if (currentWaypoints.length>0){
	var text = "";
	for (const waypoint of currentWaypoints) text += `${waypoint.lat},${waypoint.lng}|`;
	text = text.slice(0,-1);
	theLink += `&waypoints=${text}`;
    }

    console.log(theLink);
   
    const newWindow = window.open('', '_blank', 'width=800,height=200');
    if (newWindow) {
	newWindow.document.open();
	newWindow.document.write(theLink);
	//newWindow.document.close();
    } else {
	alert('Popup blocked! Please allow popups for this site.');
    }
    
    return;
}

//..................................................................
function useRouteLink(){

    if (urlParams.has("inputLocation")) document.getElementById("inputLocation").value = urlParams.get("inputLocation");
    if (urlParams.has("inputDist"))     document.getElementById("inputDist").value = urlParams.get("inputDist");
    if (urlParams.has("inputUnits"))    document.getElementById("inputUnits").value = urlParams.get("inputUnits");
    if (urlParams.has("inputMode")){
	var useMode = "cycling";
	if (urlParams.get("inputMode").toLowerCase().indexOf("driv")>=0) useMode = "driving";
	if (urlParams.get("inputMode").toLowerCase().indexOf("walk")>=0) useMode = "walking";
	if (urlParams.get("inputMode").toLowerCase().indexOf("hik")>=0) useMode = "walking";
	document.getElementById("inputMode").value = useMode;
    }
    if (urlParams.has("inputRotation")) document.getElementById("inputRotation").value = urlParams.get("inputRotation");
    if (urlParams.has("inputDirection")) document.getElementById("inputDirection").value = urlParams.get("inputDirection");
    if (urlParams.has("method"))       document.getElementById("method").value = urlParams.get("method");
    if (urlParams.has("inputHighways")) document.getElementById("inputHighways").value = urlParams.get("inputHighways");
    if (urlParams.has("inputFerries"))  document.getElementById("inputFerries").value = urlParams.get("inputFerries");
    var waypoints = [];
    var pts = [];
    if (urlParams.has("waypoints")){
	pts = urlParams.get("waypoints");
	pts = pts.split("|");
	for (item of pts){
	    var pair = item.split(",");
	    waypoints.push({lat:pair[0],lng:pair[1]});
	}
    }

    doRL(waypoints);

    return;
}
