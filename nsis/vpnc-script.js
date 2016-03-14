// vpnc-script-win.js
//
// Sets up the Network interface and the routes
// needed by vpnc.

// --------------------------------------------------------------
// Utilities
// --------------------------------------------------------------

var fs = WScript.CreateObject("Scripting.FileSystemObject");
var tmpdir = fs.GetSpecialFolder(2)+"\\";
var log = fs.OpenTextFile(tmpdir + "vpnc.log", 8, true);
var WshShell = WScript.CreateObject ("WScript.Shell");
var searchList = WshShell.RegRead ("HKLM\\System\\CurrentControlSet\\Services\\TCPIP\\Parameters\\SearchList");

function echo(msg)
{
       log.WriteLine(msg);
}

function exec(cmd)
{
       var s = "";
       echo("executing: " + cmd);

       if (fs.FileExists(tmpdir + "vpnc.out")) {
               fs.DeleteFile(tmpdir + "vpnc.out");
       }
       ws.Run("cmd.exe /c " +cmd+" > " + tmpdir + "vpnc.out", 0, true);

       if (fs.FileExists(tmpdir + "vpnc.out")) {
               var f = fs.OpenTextFile(tmpdir + "vpnc.out", 1);
               if (f) {
                      if (!f.AtEndOfStream) {
                           s = f.ReadAll();
                       }
                       log.Write(s);
                       f.Close();
	       }
       }
       return s;
}

function getDefaultGateway()
{
	if (exec("route print -4").match(/0\.0\.0\.0 *(0|128)\.0\.0\.0 *([0-9\.]*)/)) {
		return (RegExp.$2);
	}
	return ("");
}

function getInterfaceId(ifname)
{
	var rx_ifname_sanitizer = new RegExp("[^\\d\\w ]");
	var ifname_sanitized = ifname.replace(rx_ifname_sanitizer, ".", "g");
	var rx_ifid = new RegExp("^ *([0-9]+) *.*" + ifname_sanitized + "$", "m");
	if (exec("netsh interface ip show interfaces").search(rx_ifid) != -1) {
		return (RegExp.$1);
	}
	echo("interface \"" + ifname + "\" not found");
	return (ifname);
}

function waitForInterface() {
	var if_route = new RegExp(env("INTERNAL_IP4_ADDRESS") + " *255.255.255.255");
	for (var i = 0; i < 7; i++) {
		echo("Waiting for interface to come up...");
		if (exec("route print -4 " + env("INTERNAL_IP4_ADDRESS")).match(if_route)) {
			return true;
		}
		WScript.Sleep(1000);
	}
	return false;
}
function addRoute(ip, mask, gw ) {
	var if_route = new RegExp("(" + ip + " *"+ mask + " *" + gw + ")", "m");

	exec("route add " + ip  + " mask " + mask + " " + gw);
	for (var i = 0; i < 15; i++) {
		echo("Waiting for route to come up...");
		if (exec("route print -4").match(if_route)) {
			return true;
		}
		WScript.Sleep(1000);
	}
	echo("Route " + ip + " mask " + mask + " does not seem to be up.");
	return false;
}
var HKLM = 0x80000002; 

function regGetUUID( strRegPath, inf) { 
  try { 
    var aUUID = null; 
    var bUUID = null; 
    var objLocator     = new ActiveXObject("WbemScripting.SWbemLocator"); 
    var objService     = objLocator.ConnectServer(".", "root\\default"); 
    var objReg         = objService.Get("StdRegProv"); 
    var objMethod      = objReg.Methods_.Item("EnumKey"); 
    var objInParam     = objMethod.InParameters.SpawnInstance_(); 
    objInParam.hDefKey = HKLM; 
    objInParam.sSubKeyName = strRegPath; 
    var objOutParam = objReg.ExecMethod_(objMethod.Name, objInParam); 

    if (objOutParam.ReturnValue ==0) 
    { 
        aUUID = (objOutParam.sNames != null) ? objOutParam.sNames.toArray(): null; 
		    for (var idx=0; idx < aUUID.length;idx++) 
        { 
          objInParam.sSubKeyName = strRegPath + "\\" + aUUID[idx]
          objOutParam = objReg.ExecMethod_(objMethod.Name, objInParam)
          if (objOutParam.ReturnValue == 0){
          	if (objOutParam.sNames != null) {
          		bUUID = objOutParam.sNames.toArray(); 
          		for (var j=0; j < bUUID.length;j++){ 
         	  		try{ 
         					var strReg = WshShell.RegRead ("HKLM\\System\\CurrentControlSet\\Control\\Network\\" 
         						+ aUUID[idx] + "\\" + bUUID[j] + "\\Connection\\Name");
									if (strReg != null){
										if (inf == strReg){
											return (bUUID[j]);
										}
									} 
								}
  							catch(e) {  
  							}
							}
  					}
  				}	
  			} 
				return ("");
    } 
    return (""); 
  } 
  catch(e) {  
    return (""); 
  } 
}

// --------------------------------------------------------------
// Script starts here
// --------------------------------------------------------------

var internal_ip4_netmask = "255.255.255.0";

var ws = WScript.CreateObject("WScript.Shell");
var env = ws.Environment("Process");

// How to add the default internal route
// 0 - As interface gateway when setting properties
// 1 - As a 0.0.0.0/0 route with a lower metric than the default route
// 2 - As 0.0.0.0/1 + 128.0.0.0/1 routes (override the default route cleanly)
var REDIRECT_GATEWAY_METHOD = 0;
var tundevid = getInterfaceId(env("TUNDEV"));
var tunReg 	= regGetUUID ("System\\CurrentControlSet\\Control\\Network\\",env("TUNDEV"));

function getInterfaceId(ifname)
{
	var rx_ifid = new RegExp("^ *([0-9]+) *.*" + ifname + "$", "m")
	if (exec("netsh interface ip show interfaces").search(rx_ifid)) {
		return (RegExp.$1);
	}
	return ("");
}

switch (env("reason")) {
case "pre-init":
	break;
case "connect":
  echo("================== Connect ============");
	var gw = getDefaultGateway();
	var address_array = env("INTERNAL_IP4_ADDRESS").split(".");
	var netmask_array = env("INTERNAL_IP4_NETMASK").split(".");
	// Calculate the first usable address in subnet
	var internal_gw_array = new Array(
		address_array[0] & netmask_array[0],
		address_array[1] & netmask_array[1],
		address_array[2] & netmask_array[2],
		(address_array[3] & netmask_array[3]) + 1
	);
	if (internal_gw_array[3] == address_array[3]){
		internal_gw_array[3] = (address_array[3] & netmask_array[3] ) + 2
  }
	var internal_gw = internal_gw_array.join(".");
  if (searchList.search(env("CISCO_DEF_DOMAIN")) != 0) {
  	searchList = env("CISCO_DEF_DOMAIN") + "," + searchList;
		WshShell.RegWrite ("HKLM\\System\\CurrentControlSet\\Services\\TCPIP\\Parameters\\SearchList", 
		   searchList, "REG_SZ");
		exec("ipconfig /registerdns");
  }	
  if (tunReg != "") {
  	WshShell.RegWrite ("HKLM\\System\\CurrentControlSet\\Services\\TCPIP\\Parameters\\Interfaces\\" + tunReg + "\\Domain",
		   env("CISCO_DEF_DOMAIN"), "REG_SZ");
	}
	echo("DNS suffix search: " + searchList);
	echo("VPN Gateway: " + env("VPNGATEWAY"));
	echo("Internal Address: " + env("INTERNAL_IP4_ADDRESS"));
	echo("Internal Netmask: " + env("INTERNAL_IP4_NETMASK"));
	echo("Internal Gateway: " + internal_gw);
	echo("Interface name  : \"" + env("TUNDEV") + "\" " + tunReg);
	echo("Interface id    : " + tundevid);
	// Add direct route for the VPN gateway to avoid routing loops
	addRoute(env("VPNGATEWAY"), "255.255.255.255", gw);

	if (env("INTERNAL_IP4_MTU")) {
	    echo("MTU: " + env("INTERNAL_IP4_MTU"));
	    exec("netsh interface ipv4 set subinterface \"" + tundevid +
		"\" mtu=" + env("INTERNAL_IP4_MTU") + " store=active");
	    if (env("INTERNAL_IP6_ADDRESS")) {
		exec("netsh interface ipv6 set subinterface \"" + tundevid +
		    "\" mtu=" + env("INTERNAL_IP4_MTU") + " store=active");
	    }
	}

	echo("Configuring \"" + tundevid + "\" interface for Legacy IP...");
	
	if (!env("CISCO_SPLIT_INC") && REDIRECT_GATEWAY_METHOD != 2) {
		// Interface metric must be set to 1 in order to add a route with metric 1 since Windows Vista
		exec("netsh interface ip set interface \"" + tundevid + "\" metric=1");
	}
	
	if (env("CISCO_SPLIT_INC") || REDIRECT_GATEWAY_METHOD > 0) {
		exec("netsh interface ip set address \"" + tundevid + "\" static " +
			env("INTERNAL_IP4_ADDRESS") + " " + env("INTERNAL_IP4_NETMASK"));
	} else {
		// The default route will be added automatically
		exec("netsh interface ip set address \"" + tundevid + "\" static " +
			env("INTERNAL_IP4_ADDRESS") + " " + env("INTERNAL_IP4_NETMASK") + " " + internal_gw + " 1");
	}
		// Waiting for the interface to be configured before to add routes
	if (!waitForInterface()) {
			echo("Interface does not seem to be up.");
	}

    if (env("INTERNAL_IP4_NBNS")) {
		var wins = env("INTERNAL_IP4_NBNS").split(/ /);
		for (var i = 0; i < wins.length; i++) {
		    addRoute(wins[i], "255.255.255.255", internal_gw);
	      exec("netsh interface ipv4 add wins \"" +
			    tundevid + "\" " + wins[i]
			    + " index=" + (i+1));
		}
	}

    if (env("INTERNAL_IP4_DNS")) {
		var dns = env("INTERNAL_IP4_DNS").split(/ /);
		for (var i = 0; i < dns.length; i++) {
		    addRoute(dns[i], "255.255.255.255", internal_gw);
	      exec("netsh interface ipv4 add dns \"" +
			    tundevid + "\" " + dns[i] 
			    + " index=" + (i+1));
		}
	}
 
    if (env("CISCO_SPLIT_INC")) {   	
	// Add split tunnel network routes
		for (var i = 0 ; i < parseInt(env("CISCO_SPLIT_INC")); i++) {
			var network = env("CISCO_SPLIT_INC_" + i + "_ADDR");
			var netmask = env("CISCO_SPLIT_INC_" + i + "_MASK");
			addRoute(network, netmask, internal_gw);
		}
	} else if (REDIRECT_GATEWAY_METHOD > 0) {
		
		if (REDIRECT_GATEWAY_METHOD == 1) {
			exec("route add 0.0.0.0 mask 0.0.0.0 " + internal_gw + " metric 1");
		} else {
			exec("route add 0.0.0.0 mask 128.0.0.0 " + internal_gw);
			exec("route add 128.0.0.0 mask 128.0.0.0 " + internal_gw);
		}
	}
	echo("IPv4 route configuration done.");

  if (env("INTERNAL_IP6_ADDRESS")) {
		echo("Configuring \"" +  tundevid + "\" interface for IPv6...");

		exec("netsh interface ipv6 set address \"" + tundevid + "\" " +
		    env("INTERNAL_IP6_ADDRESS") + " store=active");

		echo("done.");

		// Add internal network routes
	  echo("Configuring IPv6 networks:");
	        if (env("INTERNAL_IP6_NETMASK") && !env("INTERNAL_IP6_NETMASK").match("/128$")) {
			exec("netsh interface ipv6 add route " + env("INTERNAL_IP6_NETMASK") +
			    " \"" + tundevid + "\" fe80::8 store=active");
		}

	        if (env("CISCO_IPV6_SPLIT_INC")) {
			for (var i = 0 ; i < parseInt(env("CISCO_IPV6_SPLIT_INC")); i++) {
				var network = env("CISCO_IPV6_SPLIT_INC_" + i + "_ADDR");
				var netmasklen = env("CISCO_SPLIT_INC_" + i +
						 "_MASKLEN");
				exec("netsh interface ipv6 add route " + network + "/" +
				    netmasklen + " \"" + tundevid + "\" fe80::8 store=active");
			}
		} else {
			echo("Setting default IPv6 route through VPN.");
			exec("netsh interface ipv6 add route 2000::/3 \"" + tundevid +
			    "\" fe80::8 store=active");
		}
		echo("IPv6 route configuration done.");
	}

	if (env("CISCO_BANNER")) {
		echo("--------------------------------------------------");
		echo(env("CISCO_BANNER"));
		echo("--------------------------------------------------");
	}
	echo("done.");
	break;
case "disconnect":
  echo("================== Disconnect ============");
	// Delete direct route for the VPN gateway
		for (var i = 0 ; i < parseInt(env("CISCO_SPLIT_INC")); i++) {
			var network = env("CISCO_SPLIT_INC_" + i + "_ADDR");
			var netmask = env("CISCO_SPLIT_INC_" + i + "_MASK");
			exec("route delete " + network + " mask " + netmask );
		}
  if (env("INTERNAL_IP4_NBNS")) {
		var wins = env("INTERNAL_IP4_NBNS").split(/ /);
		for (var i = 0; i < wins.length; i++) {
	                exec("netsh interface ipv4 delete wins \"" +
			    tundevid + "\" " + wins[i]);
	  							exec("route delete " + wins[i] + " mask 255.255.255.255");
	}
	}

  if (env("INTERNAL_IP4_DNS")) {
		var dns = env("INTERNAL_IP4_DNS").split(/ /);
		for (var i = 0; i < dns.length; i++) {
	                exec("netsh interface ipv4 delete dns \"" +
			    tundevid + "\" " + dns[i] );
	  							exec("route delete " + dns[i] + " mask 255.255.255.255");
		}
	}
  searchList = WshShell.RegRead ("HKLM\\System\\CurrentControlSet\\Services\\TCPIP\\Parameters\\SearchList");
	var searchList_array = searchList.split(",");
	for (i = searchList_array.length - 1; i >= 0; i--){
		if (searchList_array[i] == env("CISCO_DEF_DOMAIN")) {
			searchList_array.splice(i, 1);
		}
	}
	searchList = searchList_array.join(",");
  if (WshShell.RegRead ("HKLM\\SYSTEM\\ControlSet001\\services\\Tcpip\\Parameters\\Domain") == env("CISCO_DEF_DOMAIN")){
  	if (searchList == ""){
  		searchList = env("CISCO_DEF_DOMAIN");
  	} else {
   		searchList = env("CISCO_DEF_DOMAIN") + "," + searchList;
  	}
  }
  WshShell.RegWrite ("HKLM\\System\\CurrentControlSet\\Services\\TCPIP\\Parameters\\SearchList", searchList, "REG_SZ");
	echo("DNS suffix search: " + searchList);
  if (tunReg != "") {
  	WshShell.RegWrite ("HKLM\\System\\CurrentControlSet\\Services\\TCPIP\\Parameters\\Interfaces\\" + tunReg + "\\Domain",
		   "", "REG_SZ");
	}
	exec("ipconfig /registerdns");
	exec("route delete " + env("VPNGATEWAY") + " mask 255.255.255.255");
	
	if (env("CISCO_SPLIT_INC") || REDIRECT_GATEWAY_METHOD > 0) {
		exec("netsh interface ip delete address \"" + tundevid + "\" " + 
			env("INTERNAL_IP4_ADDRESS"));
	} else {
		exec("netsh interface ip delete address \"" + tundevid + "\" " +
			env("INTERNAL_IP4_ADDRESS") + " " + internal_gw);
	}
	if (!env("CISCO_SPLIT_INC") && REDIRECT_GATEWAY_METHOD != 2) {
		exec("netsh interface ip delete interface \"" + tundevid + "\"");
	}

	//  ======================== IPv6 ===================================
  if (env("INTERNAL_IP6_ADDRESS")) {
		exec("netsh interface ipv6 delete address \"" + tundevid + "\" " +
		    env("INTERNAL_IP6_ADDRESS"));

			// Delete internal network routes
	        echo("Configuring Legacy IP networks:");
	        if (env("INTERNAL_IP6_NETMASK") && !env("INTERNAL_IP6_NETMASK").match("/128$")) {
			exec("netsh interface ipv6 delete route " + env("INTERNAL_IP6_NETMASK") +
			    " \"" + tundevid + "\"");
		}

	        if (env("CISCO_IPV6_SPLIT_INC")) {
			for (var i = 0 ; i < parseInt(env("CISCO_IPV6_SPLIT_INC")); i++) {
				var network = env("CISCO_IPV6_SPLIT_INC_" + i + "_ADDR");
				var netmasklen = env("CISCO_SPLIT_INC_" + i +
						 "_MASKLEN");
				exec("netsh interface ipv6 delete route " + network + "/" +
				    netmasklen + " \"" + tundevid + "\"");
			}
		} else {
			echo("Deleting default IPv6 route through VPN.");
			exec("netsh interface ipv6 delete route 2000::/3 \"" + tundevid +
			    "\"");
		}
		echo("IPv6 route configuration done.");
	}
	echo("done.");
}

log.Close();
WScript.Quit(0);
