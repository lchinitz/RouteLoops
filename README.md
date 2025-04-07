# RouteLoops  
This is working RouteLoops code.  
It works using APIs from various mapping services.  
Code for various services is stored in separate directories.  
  
To run the code:  
1. You will need Node.js running on your machine.  
   - Current working version running under Node.js version 22.12.0.  
2. You will need an API key for whatever mapping service you choose to use.  
   - Put the API key into index.html
   - Place a .env file into the same directory as the server.js code.  Each example is separate (Google, OSM, MapBox) so a separate .env is needed for each.
     * Create a .env file with GOOGLE_API_KEY=YOUR VALID GOOGLE MAPS API KEY  
     * Create a .env file with OSM_API_KEY=YOUR VALID OSM MAPS API KEY 
     * Create a .env file with MAPBOX_API_KEY=YOUR VALID MAPBOX API KEY 
3. Start by running the server code.  For example, "node serverCode.js" in the GoogleVersion directory.  
4. This should launch a server running at port 8080.  
5. Use a browser and navigate to localhost:8080.  You should see the RouteLoops user interface.

April 7, 2025 Update
1. An update has enabled API-based uploads directly to a Garmin Connect account.  In order to do this, if you decide to deploy your own version of RouteLoops, you would need a Garmin Connect Developer account, with associated keys.  This requires review by Garmin, but go here to start:  https://developerportal.garmin.com.

This code is freely licensed.  You are welcome to use and modify.  Please make modifications available to the wider community.
