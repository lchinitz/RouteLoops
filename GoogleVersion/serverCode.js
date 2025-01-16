import express from 'express';
import bodyParser from 'body-parser';
import * as fs from 'fs';
import util from 'util';
import cors from'cors';
import fetch from 'node-fetch';
import decodePolyline from 'decode-google-map-polyline';
import {Client} from "@googlemaps/google-maps-services-js";
const client = new Client({});
import dotenv from 'dotenv';
dotenv.config();

var app = express();
app.use(cors());
app.use(express.static('./'));
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

app.get('/info',info);
app.get('/directions',directions);
app.post('/directions',directions);
app.get('/geocode',geocode);
app.post('/geocode',geocode);
app.get('/getRLpoints',getRLpoints);
app.post('/getRLpoints',getRLpoints);
app.get('/cleanTails',cleanTails);
app.post('/cleanTails',cleanTails);
app.get('/modifyDirections',modifyDirections);
app.post('/modifyDirections',modifyDirections);
app.post('/showDirections',showDirections);
app.post('/makeSparseGPX',makeSparseGPX);
app.post('/makeDenseGPX',makeDenseGPX);
app.post('/makeTCX',makeTCX);
app.post('/removeWaypoint',removeWaypoint);
app.get('/readFile',readFile);

// Setup Server
const thePort = 8282
app.listen(thePort, function () {
    console.log(`Server has been started and is listening on port ${thePort}`);
});

//*/
//Secure Server
import https from 'https';
https.createServer(
    {
	key: fs.readFileSync('/etc/letsencrypt/live/routeloops.com/privkey.pem'),
	cert: fs.readFileSync('/etc/letsencrypt/live/routeloops.com/cert.pem'),
	ca: fs.readFileSync('/etc/letsencrypt/live/routeloops.com/fullchain.pem')
    },app
  )
  .listen(8445, () => {
    console.log('Listening on 8445 ...')
  })
//*/


//.......................................................................
function info(req,res,next)
{
    var html = fs.readFileSync('./info.html');
    res.writeHead(200, {'Content-type': 'text/html'} );
    res.end(html);

    return;
}
//..................................................................

async function directions(req,res,next)
{

    var method = req.method;
    var url = req.url;
    
    if (method.toLowerCase() == 'get'){
        //console.log('url ' + url);
        var split1 = url.split('?');
        var result = {lat:null,lng:null,highways:null,ferries:null,waypoints:null,mode:null};
        if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
                var split3 = split2[i].split('=');
                if(split3[0] == 'lat')      result.lat      = split3[1];
                if(split3[0] == 'lng')      result.lng      = split3[1];
                if(split3[0] == 'highways') result.highways = split3[1];
                if(split3[0] == 'ferries')  result.ferries  = split3[1];
                if(split3[0] == 'waypoints')result.waypoints= split3[1];
                if(split3[0] == 'mode')     result.mode     = split3[1];
	    }
        }
	console.log('Doing a directions GET call:');
	console.log(JSON.stringify(result,null,2));

	var avoids = "tolls";
	if (result.ferries == "yes") avoids += "|ferries";
	if (result.highways == "yes") avoids += "|highways";

	var api_root =    "https://maps.googleapis.com/maps/api/directions/json?";
	var key =         process.env.GOOGLE_API_KEY;
	var origin      = `${result.lat},${result.lng}`; //`42,-71`;
	var destination = `${result.lat},${result.lng}`; //`43,-71`;
	var url = api_root + `origin=${origin}&destination=${destination}&key=${key}`;
	url += `&avoid=${avoids}`;
	url += `&mode=${result.mode.toLowerCase()}`;
	if (result.waypoints != null) url += `&waypoints=${result.waypoints}`;
	console.log(url);

	var theWayPoints = result.waypoints.split("|");
	var wpts = [];
	var wptString= "";
	for (var i=0;i<theWayPoints.length;i++)
	{
	    var thisWayPoint = theWayPoints[i].split(",");
	    var theWayPoint  = {lat:thisWayPoint[0],lng:thisWayPoint[1]};
	    wpts.push({
		location:theWayPoint,
		stopover:false});
	    wptString += 'via:' + theWayPoint.lat + ',' + theWayPoint.lng + "|";
	}
	wptString = wptString.slice(0,-1);
	//alert("Wpts length is :"+wpts.length);
	

	const response = await fetch(url);
	const theJson = await response.json();
	
	//console.log(theJson.routes);

	//Get the detailed road structure, and put it into the returned JSON under step/polyline/array
	for (const route of theJson.routes){
	    var allPoints = [];
	    for (const leg of route.legs){
		for (const step of leg.steps){
		    var pPoints = step.polyline.points;
		    //console.log(pPoints);
		    var array = decodePolyline(pPoints);
		    //console.log(array);
		    step.polyline.array = array;
		    allPoints.push({lat:step.start_location.lat,lng:step.start_location.lng,instructions:step.html_instructions,maneuver:step.maneuver});
		    for (const point of step.polyline.array) allPoints.push({lat:point.lat,lng:point.lng});
		    allPoints.push({lat:step.end_location.lat,lng:step.end_location.lng});
		}
	    }
	    for (var a=allPoints.length-1;a>=1;a--){
		if(allPoints[a].lat==allPoints[a-1].lat && allPoints[a].lng==allPoints[a-1].lng){
		    allPoints[a-1].instructions = allPoints[a].instructions;
		    allPoints[a-1].maneuver = allPoints[a].maneuver;
		    allPoints.splice(a,1);
		}
	    }
	    var cumulativeDistance = 0;
	    allPoints[0].cumulativeDistanceKm = 0;
	    for (var a=1;a<allPoints.length;a++){
		cumulativeDistance += LatLngDist(allPoints[a-1].lat,allPoints[a-1].lng,allPoints[a].lat,allPoints[a].lng);
		allPoints[a].cumulativeDistanceKm = cumulativeDistance;
	    }
	    route.totalDistanceKm = cumulativeDistance;
	    //Get distance to next instruction
	    for (var a=0;a<allPoints.length;a++){
		if (!allPoints[a].hasOwnProperty("instructions")) continue;
		var distanceToNext = 0;
		for (var b=a+1;b<allPoints.length;b++){
		    distanceToNext += LatLngDist(allPoints[b-1].lat,allPoints[b-1].lng,allPoints[b].lat,allPoints[b].lng);
		    if (allPoints[b].hasOwnProperty("instructions"))break;
		}
		allPoints[a].distanceToNextKm = distanceToNext;
		allPoints[a].nextInstructionAt = b;
		a = b-1; //Because it will increment when it goes back to the top.
	    }
	    
	    route.allPoints = allPoints;
	}
		
	res.json(theJson);
    }
    
    else if (method.toLowerCase() == 'post'){
    }
        
}

//.............................................................................
async function geocode(req,res,next)
{
    
    var method = req.method;
    var url = req.url;
    
    if (method.toLowerCase() == 'get'){
        //console.log('url ' + url);
        var split1 = url.split('?');
        var result = {location:null};
        if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
                var split3 = split2[i].split('=');
                if(split3[0] == 'location') result.location = split3[1];
	    }
        }
	console.log('Doing a geocode GET call:');
	console.log(JSON.stringify(result,null,2));

	var api_root = "https://maps.googleapis.com/maps/api/geocode/json?";
	var theLocation = result.location;
	var key =         process.env.GOOGLE_API_KEY;
	var url = api_root + `address=${theLocation}&key=${key}`;

	const response = await fetch(url);
	const theJson = await response.json();
	//console.log(JSON.stringify(theJson));
	res.json(theJson);
    }
    
    else if (method.toLowerCase() == 'post'){
    }
    
}

//...........................................................................................

async function getRLpoints(req,res,next)
{
    var method = req.method;
    var url = req.url;
    if (method.toLowerCase() == 'get'){
        //console.log('url ' + url);
        var split1 = url.split('?');
        var result = {lat:null,lng:null,dist:null,units:null,method:null,direction:null,rotation:null};
        if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
                var split3 = split2[i].split('=');
                if(split3[0] == 'lat') result.lat = split3[1];
                if(split3[0] == 'lng') result.lng = split3[1];
                if(split3[0] == 'dist') result.dist = split3[1];
                if(split3[0] == 'units') result.units = split3[1];
                if(split3[0] == 'method') result.method = split3[1];
                if(split3[0] == 'direction') result.direction = split3[1];
                if(split3[0] == 'rotation') result.rotation = split3[1];
	    }
        }

	var LatLng = {lat:1*result.lat,lng:1*result.lng};
	
	console.log('Doing a getRLpoints GET call:');
	console.log(JSON.stringify(result,null,2));	

	var targetLengthInMeters = result.dist;

	var units = result.units;
	if (units==null)units = "imperial";
	if (units=="imperial")  targetLengthInMeters *=5280*12*2.54/100;
	if (units=="metric")    targetLengthInMeters *=1000;

	var direction = result.direction;
	if (direction==null) direction = 0;

	var rotation = result.rotation;
	if (rotation == null) rotation = "clockwise";

	var pickMethod = result.method;
	
	if (pickMethod=="random" || pickMethod==null){
	    var methods = ["circular","rectangular","figure8"];
	    pickMethod = methods[Math.floor(Math.random() * methods.length)];
	}
	
	var rlPoints = [];
	if(pickMethod=="circular") rlPoints = circleRoute(LatLng,targetLengthInMeters,direction,rotation);
	if(pickMethod=="rectangular") rlPoints = rectangleRoute(LatLng,targetLengthInMeters,direction,rotation);
	if(pickMethod=="figure8") rlPoints = fig8Route(LatLng,targetLengthInMeters,direction,rotation);
	
	res.json(rlPoints);
    }
    
    else if (method.toLowerCase() == 'post'){
    }
}

//........................................................................................
function circleRoute(BaseLocation,length,travelHeading,rotation)
{
    
    //alert("Doing a circular route");
    
    var radius = length/2/Math.PI;
    //log ("The radius of the circle is " + radius);
    var circlePoints = 4;
    var deg = [];
    var rlPoints = [];
    
    //Choose a direction for this value
    var direction = Math.random()*2*Math.PI;  //in radians
    if(travelHeading==0)
	direction = Math.random()*2*Math.PI;  //in radians
    else if(travelHeading==1) //this is North
	direction = Math.random()*Math.PI/4 + 3*Math.PI/8;
    else if(travelHeading==2) //this is Northeast
	direction = Math.random()*Math.PI/4 + 1*Math.PI/8;
    else if(travelHeading==3) //this is East
	direction = Math.random()*Math.PI/4 - Math.PI/8;
    else if(travelHeading==4) //this is Southeast
	direction = Math.random()*Math.PI/4 + 13*Math.PI/8;
    else if(travelHeading==5) //this is South
	direction = Math.random()*Math.PI/4 + 11*Math.PI/8;
    else if(travelHeading==6) //this is Southwest
	direction = Math.random()*Math.PI/4 + 9*Math.PI/8;
    else if(travelHeading==7) //this is West
	direction = Math.random()*Math.PI/4 + 7*Math.PI/8;
    else if(travelHeading==8) //this is Northwest
	direction = Math.random()*Math.PI/4 + 5*Math.PI/8;
    //log("The direction of this point with be at " + direction*180/Math.PI + " degrees.");
    
    //Locate the point that is radius meters away from the Base Location in the direction chosen.
    //length assumed in meters, and then deltas in degrees.
    var dx = radius*Math.cos(direction);
    var dy = radius*Math.sin(direction);
    var delta_lat = dy/110540;
    var delta_lng = dx/(111320*Math.cos(BaseLocation.lat*Math.PI/180));
    var center = {lat:BaseLocation.lat+delta_lat, lng:BaseLocation.lng+delta_lng};
    //log(" The center point will be at " + center);
    //placeMarker(center,'Circle Center');

    //Find circlePoints other points to use
    //First, call the initial direction direction+180, since we are looking in the opposite direction.
    deg.push(direction + Math.PI);
    var sign = -1;
    if(rotation=="clockwise") sign = -1;
    else sign = +1;
    
    for(var i=1;i<circlePoints+1;i++)
    {
	deg.push(deg[i-1] + sign*2*Math.PI/(circlePoints+1));
	dx = radius*Math.cos(deg[i]);
	dy = radius*Math.sin(deg[i]);
	delta_lat = dy/110540;
	delta_lng = dx/(111320*Math.cos(center.lat*Math.PI/180));
	rlPoints.push({lat:center.lat+delta_lat,lng:center.lng+delta_lng});
    }

    return rlPoints;
}

//.........................................................................................
function rectangleRoute(BaseLocation,length,travelHeading,rotation)
{

  //alert("Doing a rectangular route");

    var direction = 0;
    var angle = 0;
    var rlPoints = [];
    
    //Choose a ratio of height to width.  This may be more complex than necessary, but what the heck.
    var maxRatio = 5;
    var minRatio = 1./maxRatio;
    var deltaRatio = maxRatio - minRatio;
    var ratio = Math.random()*deltaRatio + minRatio;
    //alert("Ratio for this box is " + ratio);
    //var ratio = 2;
    var width = length/(2*ratio+2);
    var height = width*ratio;
    var diagonal = Math.sqrt(width*width + height*height);
    var theta = Math.acos(height/diagonal);

    //Choose a direction for this value
    if(travelHeading==0)
	var direction = Math.random()*2*Math.PI;  //in radians
    else if(travelHeading==1) //this is North
	var direction = Math.random()*Math.PI/4 + 3*Math.PI/8;
    else if(travelHeading==2) //this is Northeast
	var direction = Math.random()*Math.PI/4 + 1*Math.PI/8;
    else if(travelHeading==3) //this is East
	var direction = Math.random()*Math.PI/4 - Math.PI/8;
    else if(travelHeading==4) //this is Southeast
	var direction = Math.random()*Math.PI/4 + 13*Math.PI/8;
    else if(travelHeading==5) //this is South
	var direction = Math.random()*Math.PI/4 + 11*Math.PI/8;
    else if(travelHeading==6) //this is Southwest
	var direction = Math.random()*Math.PI/4 + 9*Math.PI/8;
    else if(travelHeading==7) //this is West
	var direction = Math.random()*Math.PI/4 + 7*Math.PI/8;
    else if(travelHeading==8) //this is Northwest
	var direction = Math.random()*Math.PI/4 + 5*Math.PI/8;
    //log("The direction of this point with be at " + direction*180/Math.PI + " degrees.");

    var sign = -1;
    if(rotation=="clockwise") sign = -1;
    else sign = +1;
    
    //There are 3 points to locate.  Easiest in this case to do each separately.
    //Locate the point that is radius meters away from the Base Location in the direction chosen.
    //length assumed in meters, and then deltas in degrees.
    angle = 0+direction; // This is defined to be the point along the "height" direction
    var dx = height*Math.cos(angle);
    var dy = height*Math.sin(angle);
    var delta_lat = dy/110540;
    var delta_lng = dx/(111320*Math.cos(BaseLocation.lat*Math.PI/180));
    rlPoints.push({lat:BaseLocation.lat+delta_lat, lng:BaseLocation.lng+delta_lng});
    //alert(" The first corner point will be at " + p1);
    //placeMarker(p1,'h corner');

    angle = sign*theta+direction; // This is defined to be the point along the "diagonal" direction
    var dx = diagonal*Math.cos(angle);
    var dy = diagonal*Math.sin(angle);
    var delta_lat = dy/110540;
    var delta_lng = dx/(111320*Math.cos(BaseLocation.lat*Math.PI/180));
    rlPoints.push({lat:BaseLocation.lat+delta_lat, lng:BaseLocation.lng+delta_lng});
    //alert(" The second corner point will be at " + p2);
    //placeMarker(p2,'d corner');
    
    angle = sign*Math.PI/2+direction; // This is defined to be the point along the "width" direction
    var dx = width*Math.cos(angle);
    var dy = width*Math.sin(angle);
    var delta_lat = dy/110540;
    var delta_lng = dx/(111320*Math.cos(BaseLocation.lat*Math.PI/180));
    rlPoints.push({lat:BaseLocation.lat+delta_lat, lng:BaseLocation.lng+delta_lng});
    //alert(" The second corner point will be at " + p3);
    //placeMarker(p3,'w corner');

    return rlPoints;

}
//.............................................................
function fig8Route(BaseLocation,length,travelHeading,rotation)
{

    /*
      The figure 8 will be done as 2 circles, each of half the desired length.
    */
    
    //alert("Doing a figure 8 route");
    
    //FIRST CIRCLE
    var radius = length/4/Math.PI;
    //log ("The radius of the first circle is " + radius);
    var circlePoints = 3;
    var deg = [];
    var rlPoints = [];
    
    var rlpCount;
    
    //Choose a direction for this value.  Kind of weird with the figure 8, but let's let it be for now.
    if(travelHeading==0)
	var direction = Math.random()*2*Math.PI;  //in radians
    else if(travelHeading==1) //this is North
	var direction = Math.random()*Math.PI/4 + 3*Math.PI/8;
    else if(travelHeading==2) //this is Northeast
	var direction = Math.random()*Math.PI/4 + 1*Math.PI/8;
    else if(travelHeading==3) //this is East
	var direction = Math.random()*Math.PI/4 - Math.PI/8;
    else if(travelHeading==4) //this is Southeast
	var direction = Math.random()*Math.PI/4 + 13*Math.PI/8;
    else if(travelHeading==5) //this is South
	var direction = Math.random()*Math.PI/4 + 11*Math.PI/8;
    else if(travelHeading==6) //this is Southwest
	var direction = Math.random()*Math.PI/4 + 9*Math.PI/8;
    else if(travelHeading==7) //this is West
	var direction = Math.random()*Math.PI/4 + 7*Math.PI/8;
    else if(travelHeading==8) //this is Northwest
	var direction = Math.random()*Math.PI/4 + 5*Math.PI/8;
    //log("The direction of the first figure 8 point with be at " + direction*180/Math.PI + " degrees.");
    
    //Locate the point that is radius meters away from the Base Location in the direction chosen.
    //length assumed in meters, and then deltas in degrees.
    var dx = radius*Math.cos(direction);
    var dy = radius*Math.sin(direction);
    var delta_lat = dy/110540;
    var delta_lng = dx/(111320*Math.cos(BaseLocation.lat*Math.PI/180));
    var center = {lat:BaseLocation.lat+delta_lat, lng:BaseLocation.lng+delta_lng};
    //log(" The first figure 8 center point will be at " + center);
    //placeMarker(center,'Circle Center');

    //Find circlePoints other points to use
    //First, call the initial direction direction+180, since we are looking in the opposite direction.
    deg.push(direction + Math.PI);
    var sign = -1;
    if(rotation=="clockwise") sign = -1;
    else sign = +1;

    rlpCount=0;

    for(var i=1;i<circlePoints+1;i++)
    {
	deg.push( deg[i-1] + sign*2*Math.PI/(circlePoints+1) );
	dx = radius*Math.cos(deg[i]);
	dy = radius*Math.sin(deg[i]);
	delta_lat = dy/110540;
	delta_lng = dx/(111320*Math.cos(center.lat*Math.PI/180));
	rlPoints.push( {lat:center.lat+delta_lat, lng:center.lng+delta_lng} );
	rlpCount++;
	//placeMarker(pts[i-1],'p'+i);
    }

    //At this point you have circlePoints points in the first circle.  Now do the other side of the figure 8.
    //Choose the exact opposite direction.
    direction = direction + Math.PI;
    //log("The direction of the second figure 8 point with be at " + direction*180/Math.PI + " degrees.");
    
    //Locate the point that is radius meters away from the Base Location in this new direction.
    //length assumed in meters, and then deltas in degrees.
    var dx = radius*Math.cos(direction);
    var dy = radius*Math.sin(direction);
    var delta_lat = dy/110540;
    var delta_lng = dx/(111320*Math.cos(BaseLocation.lat*Math.PI/180));
    center = {lat:BaseLocation.lat+delta_lat, lng:BaseLocation.lng+delta_lng};
    //log(" The second figure 8 center point will be at " + center);
    //placeMarker(center,'Circle Center');

    //Find circlePoints other points to use
    //First, call the initial direction direction+180, since we are looking in the opposite direction.
    deg.length = 0; // Zero out this array and use it over again here.
    deg.push(direction + Math.PI);
    //This part is a little tricky, but to make a real figure 8 I have to reverse the orientation of turns.  Do it for now.
    var sign = +1;
    if(rotation=='clockwise') sign = +1;  // NOTICE YOU HAVE REVERSED THE SIGN ON PURPOSE
    else sign = -1;  //NOTICE YOU HAVE REVERSED THE SIGN ON PURPOSE

  for(var i=1;i<circlePoints+1;i++)
    {
	deg.push( deg[i-1] + sign*2*Math.PI/(circlePoints+1) );
	dx = radius*Math.cos(deg[i]);
	dy = radius*Math.sin(deg[i]);
	delta_lat = dy/110540;
	delta_lng = dx/(111320*Math.cos(center.lat*Math.PI/180));
	rlPoints.push( {lat:center.lat+delta_lat, lng:center.lng+delta_lng} );
	rlpCount++;
    }

    return rlPoints;;
}

//..................................................................................
function LatLngDist(lat1,lon1,lat2,lon2)
{
    //Check the distance between these points -- returns a value in km.
    var R = 6371; // km
    var dLat = (lat2-lat1)*Math.PI/180;
    var dLon = (lon2-lon1)*Math.PI/180; 
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +        
	Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *         
	Math.sin(dLon/2) * Math.sin(dLon/2); 
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    var d = R * c;
    //log("The separation between these points is " + d);
    return d;
}

//..........................................................
async function cleanTails(req,res,next)
{
    var method = req.method;
    var url = req.url;
    if (method.toLowerCase() == 'get'){
    }

    else if (method.toLowerCase() == 'post'){

	var body = req.body;
	var routeLatLng = body.LLs;
	//console.log(routeLatLng);
	
	//alert("Calling cleanTails!!!!");
	var pLpoints = [];
	for(var i=0;i<routeLatLng.length;i++) pLpoints.push({lat:routeLatLng[i].lat, lng:routeLatLng[i].lng});

	var pLdist = [];
	pLdist.push(0);
	var cumulative = 0;
	var newPath = [];
	var pLuse = [];
	for(var i=0;i<pLpoints.length-1;i++){
	    pLuse.push(false);
	    cumulative += LatLngDist(pLpoints[i].lat,pLpoints[i].lng,pLpoints[i+1].lat,pLpoints[i+1].lng);
	    pLdist.push(cumulative);
	    newPath.push(pLpoints[i]);
	}
	newPath.push(pLpoints[pLpoints.length-1]);
	//alert("Cumulative distance is " + cumulative);

	//Find the point, ahead of each point, to which each point is closest.
	var closest;
	var point;
	var dist;
	var pLclose = [];
	var pLsep = [];
	for(var i=0;i<pLpoints.length;i++)
	{
	    var thisOne = pLpoints[i];
	    for(var j=i+1;j<pLpoints.length;j++)
	    {
		var thatOne = pLpoints[j];
		dist = LatLngDist(thisOne.lat,thisOne.lng,thatOne.lat,thatOne.lng);
		if(j==i+1) //initialize
		{
		    closest = dist;
		    point = j;
		}
		else
		{
		    if(dist<closest) //store this point
		    {
			closest = dist;
			point = j;
		    }
		}
	    }
	    pLclose[i] = point;
	    pLsep[i] = closest;
	}
	
	var tailSize;
	for(var i=0;i<pLpoints.length;i++)
	{
	    pLuse[i] = true;
	    if(pLclose[i]-i != 1) //indicates a potential tail
	    {
		tailSize = (pLdist[pLclose[i]] - pLdist[i])/cumulative;
		if(tailSize<0.2){	    
		    i = pLclose[i]; //Jump ahead, over this tail.
		}
	    }
	}

	newPath.length = 0;
	for(var i=0;i<pLpoints.length;i++){
	    if (i==0 || i==pLpoints.length-1) pLuse[i]=true;
	    if(pLuse[i]) newPath.push(pLpoints[i]);
	}
	
	var cleanedUp = pLpoints.length - newPath.length;

	var finalDistance = 0;
	for (var i=1;i<newPath.length;i++) finalDistance += LatLngDist(newPath[i-1].lat,newPath[i-1].lng,newPath[i].lat,newPath[i].lng);
	
	res.json({newPath:newPath,cleanedUp:cleanedUp,distKm:finalDistance});
    }    
}

//..........................................................
function modifyDirections(req,res,next)
{
    var method = req.method;
    var url = req.url;
    if (method.toLowerCase() == 'get'){
    }
    
    else if (method.toLowerCase() == 'post'){
	
	var body = req.body;
	var directions = body.directions;
	
	//Get the detailed road structure, and put it into the returned JSON under step/polyline/array
	for (const route of directions.routes){
	    var allPoints = [];
	    for (const leg of route.legs){
		for (const step of leg.steps){
		    var pPoints = step.polyline.points;
		    //console.log(pPoints);
		    var array = decodePolyline(pPoints);
		    //console.log(array);
		    step.polyline.array = array;
		    allPoints.push({lat:step.start_location.lat,lng:step.start_location.lng,instructions:step.instructions,maneuver:step.maneuver});
		    for (const point of step.polyline.array) allPoints.push({lat:point.lat,lng:point.lng});
		    allPoints.push({lat:step.end_location.lat,lng:step.end_location.lng});
		}
	    }
	    for (var a=allPoints.length-1;a>=1;a--){
		if(allPoints[a].lat==allPoints[a-1].lat && allPoints[a].lng==allPoints[a-1].lng){
		    allPoints[a-1].instructions = allPoints[a].instructions;
		    allPoints[a-1].maneuver = allPoints[a].maneuver;
		    allPoints.splice(a,1);
		}
	    }
	    var cumulativeDistance = 0;
	    allPoints[0].cumulativeDistanceKm = 0;
	    for (var a=1;a<allPoints.length;a++){
		cumulativeDistance += LatLngDist(allPoints[a-1].lat,allPoints[a-1].lng,allPoints[a].lat,allPoints[a].lng);
		allPoints[a].cumulativeDistanceKm = cumulativeDistance;
	    }
	    //Get distance to next instruction
	    for (var a=0;a<allPoints.length;a++){
		if (!allPoints[a].hasOwnProperty("instructions")) continue;
		var distanceToNext = 0;
		for (var b=a+1;b<allPoints.length;b++){
		    distanceToNext += LatLngDist(allPoints[b-1].lat,allPoints[b-1].lng,allPoints[b].lat,allPoints[b].lng);
		    if (allPoints[b].hasOwnProperty("instructions"))break;
		}
		allPoints[a].distanceToNextKm = distanceToNext;
		allPoints[a].nextInstructionAt = b;
		a = b-1; //Because it will increment when it goes back to the top.
	    }
	    
	    route.totalDistanceKm = cumulativeDistance;
	    route.allPoints = allPoints;
	}

	res.json({modifiedDirections:directions});
    }

}

//..............................................................
function showDirections(req,res,next)
{
    var method = req.method;
    var url = req.url;
    if (method.toLowerCase() == 'get'){
    }
    
    else if (method.toLowerCase() == 'post'){
	
	var body = req.body;
	/*
	var directions = body.directions;
	var status = "OK";
	var theHTML = "";

	var error = "ERROR";
	try{
	    var theRoute = directions.routes[0];
	    error = "";
	}
	catch(err){}

	if(error!=""){
	    status = "NG";
	    theHTML = `<h1>Problem getting a route when trying to generate directions.</h1>`;
	}
	*/
	
	var allPoints = body.allPoints;
	var units = body.units;
	var speed = body.speed;
	if (isNaN(speed)) speed = 10;
	if (speed<=0) speed = 10;
	var displayUnits = "kilometers";
	if (units == "imperial") displayUnits = "miles";

	var status = "OK";
	var theHTML = "";
	if(allPoints.length<=0){
	    status = "NG";
	    theHTML = `<h1>No points brought in for directions display.</h1>`;
	}
	else{
	    var currentTime = new Date();
	    var year = currentTime.getFullYear();
	    var month = currentTime.getMonth() + 1;
	    var day = currentTime.getDate();
	    var hour = currentTime.getHours();
	    var minute = currentTime.getMinutes();
	    var name = "RL-" + year + "-" + padZeros(month,2) + "-" + padZeros(day,2) + "-" + padZeros(hour,2) + padZeros(minute,2);
	    var ymd = year + "-" + padZeros(month,2) + "-" + padZeros(day,2);

	    theHTML = "";

	    theHTML += "<html><head><title>"+name+"</title>";
	    theHTML += "</head><body>";

	    theHTML += `<style>`;
	    theHTML += `table, th, td {`;
	    theHTML += `  border: 1px solid black;`;
	    theHTML += `  border-collapse: collapse;`;
	    theHTML += `}`;
	    theHTML += `tr:nth-child(even) {`;
	    theHTML += `  background-color: rgba(150, 212, 212, 0.4);`;
	    theHTML += `}`;
	    theHTML += `th:nth-child(even),td:nth-child(even) {`;
	    theHTML += `  background-color: rgba(150, 212, 212, 0.4);`;
	    theHTML += `}`;
	    theHTML += `</style>`;

	    var totalDistanceKm = allPoints[allPoints.length-1].cumulativeDistanceKm;
	    var totalDistance = showDist(totalDistanceKm,units);
	    var duration = totalDistance/speed;
	    theHTML += `${totalDistance.toFixed(1)} ${displayUnits} &nbsp;&nbsp; about &nbsp;&nbsp; ${convertHoursToHMS(duration)} at ${speed} ${displayUnits}/hour.</br>`;
	    theHTML += "<table>";
	    theHTML += "<tr>";
	    theHTML += `<th></th> <th>Instruction</th> <th>${displayUnits} to next</th><th>${displayUnits} total</th>`;
		theHTML += "</tr>";	    
	    var theIndex = 0;
	    for(var i=0;i<allPoints.length;i++)
	    {
		if (!allPoints[i].hasOwnProperty("instructions"))continue;
		theIndex += 1;
		theHTML += "<tr>";
		theHTML += `<td>${theIndex}.</td> <td>${allPoints[i].instructions}</td> <td>${showDist(allPoints[i].distanceToNextKm,units).toFixed(1)}</td>`;
		theHTML += `<td>${showDist(allPoints[i].distanceToNextKm + allPoints[i].cumulativeDistanceKm,units).toFixed(1)}</td>`;
		theHTML += "</tr>";
	    }
	    theHTML += "</table>";
	    theHTML += "</body></html>";
	}	    	

	res.json({status:status,html:theHTML,name:name});
    }
    
}

//..............................................................
function makeSparseGPX(req,res,next)
{
    var method = req.method;
    var url = req.url;
    if (method.toLowerCase() == 'get'){
    }
    
    else if (method.toLowerCase() == 'post'){
	
	var body = req.body;
	
	var allPoints = body.allPoints;
	var status = "OK";
	
	var currentTime = new Date();
	var year = currentTime.getFullYear();
	var month = currentTime.getMonth() + 1;
	var day = currentTime.getDate();
	var hour = currentTime.getHours();
	var minute = currentTime.getMinutes();
	var name = "RL-" + year + "-" + padZeros(month,2) + "-" + padZeros(day,2) + "-" + padZeros(hour,2) + padZeros(minute,2);
	var ymd = year + "-" + padZeros(month,2) + "-" + padZeros(day,2);
	var OutText = "";

	OutText += "<?xml version=\"1.0\"?>";
	OutText += "\n";

	//OutText+= "<!--\n";
	//OutText+= storeURL();
	//OutText+= "\n-->\n";

	OutText += "<gpx version=\"1.0\" creator=\"ExpertGPS 1.1 - http://www.topografix.com\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns=\"http://www.topografix.com/GPX/1/0\" xsi:schemaLocation=\"http://www.topografix.com/GPX/1/0 http://www.topografix.com/GPX/1/0/gpx.xsd\">\n";

	OutText += "<rte>\n";
	for(var i=0;i<allPoints.length;i++){
	    if(i==0){
		var Lat = allPoints[i].lat;
		var Lng = allPoints[i].lng;
		OutText += "   <rtept lat=\"" + Lat + "\" lon=\"" + Lng + "\">\n";
		OutText += "   <name> p" + 0 + "</name>\n";
		OutText += "   <desc><![CDATA[Start]]></desc>\n";
		OutText += "   </rtept>\n";
	    }
	    else{
		if (!allPoints[i].hasOwnProperty("instructions")) continue;
		var Lat = allPoints[i].lat;
		var Lng = allPoints[i].lng;
		var instruction = cleanUp(allPoints[i].instructions);
		var point = i+1;
		OutText += "   <rtept lat=\"" + Lat + "\" lon=\"" + Lng + "\">\n";
		OutText += "   <name> p" + point + "</name>\n";
		OutText += "   <desc><![CDATA[" + instruction + "]]></desc>\n";
		OutText += "   </rtept>\n";
	    }
	}
	OutText += "</rte>\n";
	OutText += "</gpx>\n";

	res.json({status:status,gpx:OutText,name:name});
    }
}

//..............................................................
function makeDenseGPX(req,res,next)
{
    var method = req.method;
    var url = req.url;
    if (method.toLowerCase() == 'get'){
    }
    
    else if (method.toLowerCase() == 'post'){
	
	var body = req.body;
	var units = body.units;
	var speed = body.speed;
	if (isNaN(speed)) speed = 10;
	if (speed<=0) speed = 10;
	var displayUnits = "kilometers";
	if (units == "imperial") displayUnits = "miles";
	var speedKph = speed;
	if (units == "imperial") speedKph = speed*5280*12*2.54/100/1000;
	
	var allPoints = body.allPoints;
	var status = "OK";

	//Update allPoints with times.
	var lastTime = null;
	for (var point of allPoints){
	    Time = point.cumulativeDistanceKm/speedKph*60*60;
	    Time = Math.round(Time); //Get rid of fractional seconds because they can lead to odd times, like 3 minutes and 60 seconds.
	    if (Time==lastTime) Time += 1;
	    point.time = Time;
	    lastTime = Time;
	}

	var currentTime = new Date();
	var year = currentTime.getFullYear();
	var month = currentTime.getMonth() + 1;
	var day = currentTime.getDate();
	var hour = currentTime.getHours();
	var minute = currentTime.getMinutes();
	var name = "RL-" + year + "-" + padZeros(month,2) + "-" + padZeros(day,2) + "-" + padZeros(hour,2) + padZeros(minute,2);
	var ymd = year + "-" + padZeros(month,2) + "-" + padZeros(day,2);
	var OutText = "";

	OutText += "<?xml version=\"1.0\"?>\n";
	//OutText += "<!--\n";
	//OutText += storeURL() + "\n";
	//OutText += "-->\n";
	OutText += "<gpx version=\"1.0\" creator=\"ExpertGPS 1.1 - http://www.topografix.com\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns=\"http://www.topografix.com/GPX/1/0\" xsi:schemaLocation=\"http://www.topografix.com/GPX/1/0 http://www.topografix.com/GPX/1/0/gpx.xsd\">\n";

	OutText += "<trk>\n";
	OutText += "  <trkseg>\n";

	for(var i=0;i<allPoints.length;i++)
	{
	    var Lat = allPoints[i].lat;
	    var Lng = allPoints[i].lng;
	    OutText += "    <trkpt lat=\"" + Lat + "\" lon=\"" + Lng + "\">\n";
	    OutText += "    <name> p" + i + " </name>\n";
	    var Time = allPoints[i].time;
	    OutText += "    <time>"+ymd+"T"+padZeros(hours(Time).toFixed(0),2)+":"+padZeros(minutes(Time).toFixed(0),2)+":"+padZeros(seconds(Time).toFixed(0),2)+"Z</time>\n";
	    OutText += "    </trkpt>\n";
	}
	OutText += "  </trkseg>\n";
	OutText += "</trk>\n";	
	OutText +="</gpx>\n";
	res.json({status:status,gpx:OutText,name:name});
    }
}	

//..............................................................
function makeTCX(req,res,next)
{
    var method = req.method;
    var url = req.url;
    if (method.toLowerCase() == 'get'){
    }
    
    else if (method.toLowerCase() == 'post'){
	
	var body = req.body;
	var units = body.units;
	var speed = body.speed;
	var advance = body.advance;
	var name = body.name;
	if (isNaN(speed)) speed = 10;
	if (speed<=0) speed = 10;
	var displayUnits = "kilometers";
	if (units == "imperial") displayUnits = "miles";
	var speedKph = speed;
	if (units == "imperial") speedKph = speed*5280*12*2.54/100/1000;
	var advanceMeters = advance;
	if (units == "imperial") advanceMeters = advance * 12 * 2.54 / 100;
	
	var allPoints = body.allPoints;
	var status = "OK";

	//Update allPoints with times.
	var lastTime = null;
	for (var point of allPoints){
	    Time = point.cumulativeDistanceKm/speedKph*60*60;
	    Time = Math.round(Time); //Get rid of fractional seconds because they can lead to odd times, like 3 minutes and 60 seconds.
	    if (Time==lastTime) Time += 1;
	    point.time = Time;
	    lastTime = Time;
	}

	//Create a list of warnings in advance
	for (const point of allPoints){
	    if (!point.hasOwnProperty("instructions")) continue;
	    var atDistance = point.cumulativeDistanceKm;
	    var advancedDistance = atDistance - advanceMeters/1000;
	    var result = findPointAtDistance(allPoints,advancedDistance);
	    if (result.atPoint != null) allPoints[result.atPoint].advancedInstructions = point.instructions;
	}
	
	var currentTime = new Date();
	var year = currentTime.getFullYear();
	var month = currentTime.getMonth() + 1;
	var day = currentTime.getDate();
	var hour = currentTime.getHours();
	var minute = currentTime.getMinutes();
	if (name.length==0)
	    name = "RL-" + year + "-" + padZeros(month,2) + "-" + padZeros(day,2) + "-" + padZeros(hour,2) + padZeros(minute,2);
	var ymd = year + "-" + padZeros(month,2) + "-" + padZeros(day,2);
	var OutText = "";

	OutText+="<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\" ?>\n";
	OutText+="<TrainingCenterDatabase xmlns=\"http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd\">\n";
	OutText+="<Courses>\n";
	OutText+="  <Course>\n";
	OutText+="  <Name>"+name+"</Name>\n";
	
	//Write out all of the Track Points
	OutText+="  <Track>\n";
	for(var i=0;i<allPoints.length;i++)
	{
	    OutText+="    <Trackpoint>\n";
	    OutText+="      <Position>\n";
	    var Lat = allPoints[i].lat;
	    OutText+="        <LatitudeDegrees>" + Lat + "</LatitudeDegrees>\n";
	    var Lng = allPoints[i].lng;
	    OutText+="        <LongitudeDegrees>" + Lng + "</LongitudeDegrees>\n";
	    var Dist = allPoints[i].cumulativeDistanceKm;
	    var Time = allPoints[i].time;
	    OutText+="      </Position>\n";
	    OutText+="      <DistanceMeters>" + (Dist*1000).toFixed(0) + "</DistanceMeters>\n";
	    OutText+="      <Time>"+ymd+"T"+padZeros(hours(Time).toFixed(0),2) 
		+":"+padZeros(minutes(Time).toFixed(0),2)
		+":"+padZeros(seconds(Time).toFixed(0),2)
		+"Z</Time>\n";
	    OutText+="    </Trackpoint>\n";
	}
	OutText+="  </Track>\n";



	//Write out all of the Course Points
	for(var i=0;i<allPoints.length;i++)
	{
	    if(!allPoints[i].hasOwnProperty("advancedInstructions"))continue;
	    
	    var instruct = allPoints[i].advancedInstructions;
	    if(instruct[instruct.length-1] == "*")instruct=instruct.slice(0,-1);
	    //Figure out the direction
	    {
		var type = "Generic";
		if(instruct.indexOf("left") >=0 )type = "Left";
		else if(instruct.indexOf("right") >=0 )type = "Right";
		else if(instruct.indexOf("Continue") >=0 )type = "Straight";
	    }
	    // Figure out the road
	    {
		var point=null,road="";
		if(instruct.indexOf(" at ") >=0 )
		{
		    point = instruct.indexOf(" at ");
		    road = instruct.substring(point+3);
		}
		else if(instruct.indexOf(" onto ") >=0 )
		{
		    point = instruct.indexOf(" onto ");
		    road = instruct.substring(point+5);
		}
		else if(instruct.indexOf(" on ") >=0 )
		{
		    point = instruct.indexOf(" on ");
		    road = instruct.substring(point+3);
		}
	    }
	    var Lat = allPoints[i].lat;
	    var Lng = allPoints[i].lng;
	    var Time = allPoints[i].time;
	    //alert("Writing item " + i + " of " + alerts + " which is" + instruct);
	    OutText+="  <CoursePoint>\n";
	    var roadOut = cleanUp(road);
	    OutText+="    <Name>" + roadOut + "</Name>\n";
	    OutText+="    <Time>"+ymd+"T"+padZeros(hours(Time).toFixed(0),2) 
		+":"+padZeros(minutes(Time).toFixed(0),2) +":"+padZeros(seconds(Time).toFixed(0),2) +"Z</Time>\n";
	    OutText+="    <Position>\n";
	    OutText+="      <LatitudeDegrees>" + Lat + "</LatitudeDegrees>\n";
	    OutText+="      <LongitudeDegrees>" + Lng + "</LongitudeDegrees>\n";
	    OutText+="    </Position>\n";
	    OutText+="    <PointType>" + type + "</PointType>\n";
	    var instructions = cleanUp(instruct);
	    OutText+="    <Notes><![CDATA[" + instructions +"]]></Notes>\n";
	    OutText+="  </CoursePoint>\n";
	}

	OutText+="</Course>\n";
	OutText+="</Courses>\n";
	OutText+="</TrainingCenterDatabase>\n";
		
	res.json({status:status,tcx:OutText,name:name});
    }
}
//..................................................................
function findPointAtDistance(allPoints,distanceKm){

    var result = {atPoint:null,withSeparation:null};
    for (var a=0;a<allPoints.length;a++){
	var separation = Math.abs(allPoints[a].cumulativeDistanceKm - distanceKm);
	if (result.atPoint==null) result = {atPoint:a,withSeparation:separation};
	if (separation<result.withSeparation) result = {atPoint:a,withSeparation:separation};
    }
        
    return result;
}

//..................................................................
function padZeros(theNumber, max) {
  var numStr = String(theNumber);

  while ( numStr.length < max) {
    numStr = '0' + numStr;
  }

  return numStr;
}
//..................................................................
function convertHoursToHMS(hours) {
  const totalSeconds = Math.floor(hours * 3600); 
  const hrs = Math.floor(totalSeconds / 3600);
  const remainingSeconds = totalSeconds % 3600;
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;

  return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
//...............................................................
function hours(secs) {
  return Math.floor(Math.max(secs,0)/3600.0);
}
//...............................................................
function minutes(secs) {
  return Math.floor((Math.max(secs,0) % 3600.0)/60.0);
}
//...............................................................
function seconds(secs) {
  return Math.round(Math.max(secs,0) % 60.0);
}
//..................................................................
function showDist(km,units){
    var showAs = km;
    if (units=="imperial") showAs = km*1000*100/2.54/12/5280;
    if (units=="metric")   showAs = km;
    return showAs;
}
//...............................................................................................
function cleanUp(text)
{
  var cleaned;

  cleaned = text;
  if(typeof cleaned=="undefined")cleaned="";

  //Get rid of any HTML tags.
  while(cleaned.indexOf("<") >=0)
    {
      var from = cleaned.indexOf("<");
      var to = cleaned.indexOf(">");
      var end = from;
      var start = to+1;
      var first = cleaned.slice(0,end);
      var last = cleaned.slice(start,cleaned.length);
      cleaned = first + last;
    }

  //Also there appear to be stars, from time to time.
  while(cleaned.indexOf("*") >=0)
    {
      var end = cleaned.indexOf("*");
      var first = cleaned.slice(0,end);
      var last = cleaned.slice(end+1,cleaned.length);
      cleaned = first + last;
    }
  
  return cleaned;
}

//..............................................................
function removeWaypoint(req,res,next){
    var method = req.method;
    var url = req.url;
    if (method.toLowerCase() == 'get'){
    }
    
    else if (method.toLowerCase() == 'post'){
	
	var body = req.body;
	var lat = body.lat;
	var lng = body.lng;
	var waypoints = body.waypoints;

	var closest = null;
	for (var i=0;i<waypoints.length;i++){
	    const point = waypoints[i];
	    var separation = Math.pow((lat-point.lat),2) + Math.pow((lng-point.lng),2)
	    if (closest==null) closest = {point:point,separation:separation,index:i};
	    if (separation < closest.separation) closest = {point:point,separation:separation,index:i};
	}

	waypoints.splice(closest.index,1);

	res.json({closest:closest,modifiedWaypoints:waypoints});
    }
}

//.........................................................................
async function readFile(req,res,next)
{

    var method = req.method;
    var url = req.url;
    
    if (method.toLowerCase() == 'get'){
        //console.log('url ' + url);
        var split1 = url.split('?');
        var result = {fileName:null};
        if(split1.length>1){
	    var query = split1[1];
	    var split2 = query.split('&');
	    for(var i=0;i<split2.length;i++)
	    {
                var split3 = split2[i].split('=');
                if(split3[0] == 'fileName')      result.fileName      = split3[1];
	    }
	}
	var status = "NG";
	var data = null;
	if (result.fileName != null){
	    try {
		data = fs.readFileSync(`./${result.fileName}`, 'utf8');
		//console.log(data);		
	    } catch (err) {
		console.error(err);
	    }
	}

	if (data!=null)status = "OK";
	res.json({status:status, contents:data});
    }

    else if (method.toLowerCase() == 'post'){
    }
}
    
