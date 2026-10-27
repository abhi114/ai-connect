import Cocoa
import UserNotifications

// Independent native client of the authenticated loopback companion API.
struct Row: Codable {
    let id: String, title: String, repo: String, sender: String, status: String
    let pending: Bool, verified: Bool
    let actions: [String]
    let updated_at: Double
}
struct Snapshot: Codable { let connected: Bool; let handle: String; let pending: Int; let rows: [Row] }
final class MenuApp: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate, NSMenuDelegate {
    let profile = Bundle.main.object(forInfoDictionaryKey: "AIConnectProfile") as? String ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".repo-network").path
    var item: NSStatusItem!
    var snapshot: Snapshot?
    var loading = false, menuOpen = false
    var seen = [String:String]()
    var initialized = false
    var error: String?
    let defaults = UserDefaults.standard
    let center = UNUserNotificationCenter.current()
    var timer: Timer?
    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.accessory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "AI◈"
        item.button?.toolTip = "AIConnect"
        center.delegate = self
        let actions = [UNNotificationAction(identifier:"approve",title:"Review & allow",options:[.foreground]),UNNotificationAction(identifier:"reject",title:"Reject…",options:[.foreground]),UNNotificationAction(identifier:"cancel",title:"Cancel request…",options:[.foreground])]
        var categories=Set<UNNotificationCategory>()
        for mask in 0..<8 {categories.insert(UNNotificationCategory(identifier:"request-\(mask)",actions:actions.enumerated().filter{mask & (1 << $0.offset) != 0}.map{$0.element},intentIdentifiers:[],options:[]))}
        center.setNotificationCategories(categories)
        seen = defaults.dictionary(forKey:"seen") as? [String:String] ?? [:]
        initialized = defaults.bool(forKey:"initialized")
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval:4,repeats:true){[weak self] _ in self?.refresh()}
    }
    func connection() throws -> (URL,String) {
        let data = try Data(contentsOf:URL(fileURLWithPath:profile).appendingPathComponent("dashboard.json"))
        guard let json = try JSONSerialization.jsonObject(with:data) as? [String:Any], let raw = json["url"] as? String, var parts = URLComponents(string:raw), parts.scheme == "http", parts.host == "127.0.0.1", let fragment = parts.fragment, fragment.hasPrefix("token=") else { throw NSError(domain:"AIConnect",code:1,userInfo:[NSLocalizedDescriptionKey:"Invalid local dashboard configuration"])}
        let token = String(fragment.dropFirst(6)); parts.fragment=nil;parts.path="/rpc";parts.query=nil
        return (parts.url!,token)
    }
    func rpc(_ method:String,_ args:[String:Any] = [:],done:@escaping(Result<Data,Error>)->Void) {
        do {
            let (url,token) = try connection()
            var req = URLRequest(url:url);req.httpMethod="POST";req.timeoutInterval=20
            req.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization");req.setValue("application/json",forHTTPHeaderField:"Content-Type")
            req.httpBody=try JSONSerialization.data(withJSONObject:["method":method,"args":args])
            URLSession.shared.dataTask(with:req){data,response,err in
                var result:Result<Data,Error>
                do {
                    if let err=err {throw err}
                    guard let data=data,let obj=try JSONSerialization.jsonObject(with:data) as? [String:Any] else {throw NSError(domain:"AIConnect",code:2)}
                    if let message=obj["error"] as? String {throw NSError(domain:"AIConnect",code:3,userInfo:[NSLocalizedDescriptionKey:message])}
                    guard let response=response as? HTTPURLResponse,response.statusCode==200,let value=obj["result"] else {throw NSError(domain:"AIConnect",code:4)}
                    result = .success(try JSONSerialization.data(withJSONObject:value))
                } catch { result = .failure(error) }
                DispatchQueue.main.async{done(result)}
            }.resume()
        } catch {done(.failure(error))}
    }
    @objc func refresh() {
        if loading {return};loading=true
        rpc("notification_status"){[weak self] result in
            guard let self=self else{return};self.loading=false
            do {
                let next=try JSONDecoder().decode(Snapshot.self,from:result.get());self.error=nil
                if next.connected {self.notify(next)}
                self.snapshot=next
            } catch {self.error="Companion unavailable — start its service";self.snapshot=nil}
            if !self.menuOpen {self.paint()}
        }
    }
    func notify(_ next:Snapshot) {
        var updated=[String:String]()
        for row in next.rows {
            let signature="\(row.status):\(row.pending):\(row.verified)";updated[row.id]=signature
            // First installation establishes a baseline, never floods old history.
            if initialized && seen[row.id] != signature && defaults.bool(forKey:"alerts") {
                let content=UNMutableNotificationContent()
                content.title=row.pending ? "AIConnect · approval needed" : "AIConnect · \(row.status)"
                content.body="@\(row.sender) · \(row.repo)" // Request text stays out of lock-screen previews.
                content.userInfo=["request_id":row.id]
                let mask=["approve","reject","cancel"].enumerated().reduce(0){$0 | (row.actions.contains($1.element) ? (1 << $1.offset) : 0)}
                content.categoryIdentifier="request-\(mask)"
                center.add(UNNotificationRequest(identifier:row.id,content:content,trigger:nil)){_ in}
            }
        }
        seen=updated;initialized=true;defaults.set(seen,forKey:"seen");defaults.set(true,forKey:"initialized")
    }
    func entry(_ title:String,_ action:Selector?,_ data:Any?=nil)->NSMenuItem {
        let e=NSMenuItem(title:title,action:action,keyEquivalent:"");e.target=self;e.representedObject=data;return e
    }
    func paint() {
        let menu=NSMenu();menu.delegate=self
        item.button?.title = snapshot.map{$0.pending>0 ? "AI◈ \($0.pending)" : "AI◈"} ?? "AI◈ !"
        menu.addItem(entry(error ?? (snapshot?.connected == true ? "Connected as @\(snapshot!.handle)" : "Relay offline"),nil))
        menu.addItem(entry("Open dashboard",#selector(dashboard)))
        menu.addItem(.separator())
        let rows=snapshot?.rows ?? []
        for row in rows.prefix(20) {
            let label="\(row.pending ? "● " : "")@\(row.sender) / \(row.repo) · \(row.status)"
            let parent=entry(label,nil),sub=NSMenu()
            sub.addItem(entry(row.title,nil));sub.addItem(entry(row.verified ? "Signature verified" : "Trust review needed",nil))
            sub.addItem(entry("Open dashboard / choose model",#selector(dashboard)))
            for action in row.actions {sub.addItem(entry(action == "approve" ? "Review & allow (Codex default)…" : "\(action.capitalized)…",#selector(requestAction(_:)),["id":row.id,"action":action]))}
            parent.submenu=sub;menu.addItem(parent)
        }
        if rows.isEmpty {menu.addItem(entry("No requests to show",nil))}
        if rows.count>20 {menu.addItem(entry("More requests in dashboard",#selector(dashboard)))}
        menu.addItem(.separator())
        menu.addItem(entry(defaults.bool(forKey:"alerts") ? "Mute notifications" : "Enable notifications…",#selector(toggleAlerts)))
        menu.addItem(entry("Refresh",#selector(refresh)))
        menu.addItem(entry("Quit menu bar (workers keep running)",#selector(quit)))
        item.menu=menu
    }
    func menuWillOpen(_ menu:NSMenu){menuOpen=true}
    func menuDidClose(_ menu:NSMenu){menuOpen=false}
    @objc func dashboard() {
        do {let (url,token)=try connection();var p=URLComponents(url:url,resolvingAgainstBaseURL:false)!;p.path="/";p.fragment="token=\(token)";NSWorkspace.shared.open(p.url!)}catch{show("Start the AIConnect companion, then try again.")}
    }
    @objc func toggleAlerts() {
        if defaults.bool(forKey:"alerts"){defaults.set(false,forKey:"alerts");center.removeAllDeliveredNotifications();paint();return}
        center.requestAuthorization(options:[.alert,.sound]){allowed,_ in DispatchQueue.main.async{self.defaults.set(allowed,forKey:"alerts");if !allowed {self.show("Allow AIConnect notifications in macOS System Settings → Notifications. Focus mode may also suppress banners.")};self.paint()}}
    }
    @objc func requestAction(_ sender:NSMenuItem){guard let args=sender.representedObject as? [String:String],let id=args["id"],let action=args["action"] else{return};confirmAction(id,action)}
    func confirmAction(_ id:String,_ action:String) {
        // Fetch fresh full text before confirmation. Core independently revalidates action/trust.
        rpc("get_request",["request_id":id]){result in
            do {
                let obj=try JSONSerialization.jsonObject(with:result.get()) as? [String:Any]
                guard let request=obj?["request"] as? [String:Any],let body=request["body"] as? String else {throw NSError(domain:"AIConnect",code:5)}
                let alert=NSAlert();alert.messageText="\(action.capitalized) request?"
                alert.informativeText=action == "approve" ? "Uses this Mac’s Codex account, default model and default reasoning. Changes stay in an isolated worktree and still need delivery review. Choose a model in the dashboard instead if needed." : "This changes the request’s state. Already produced work is retained."
                let scroll=NSScrollView(frame:NSRect(x:0,y:0,width:500,height:230));scroll.hasVerticalScroller=true
                let text=NSTextView(frame:scroll.bounds);text.isEditable=false;text.isRichText=false;text.string="Request \(id)\n\(request["kind"] ?? "") · \(request["repo_id"] ?? "")\n\n\(body)";text.autoresizingMask=[.width];scroll.documentView=text;alert.accessoryView=scroll
                alert.addButton(withTitle:action.capitalized);alert.addButton(withTitle:"Back");NSApp.activate(ignoringOtherApps:true)
                if alert.runModal() != .alertFirstButtonReturn {return}
                self.rpc("notification_action",["request_id":id,"action":action,"confirmed":true]){result in
                    switch result {case .success: self.center.removeDeliveredNotifications(withIdentifiers:[id]);self.refresh();case .failure(let error):self.show(error.localizedDescription)}
                }
            } catch {self.show(error.localizedDescription)}
        }
    }
    func show(_ message:String){let alert=NSAlert();alert.messageText="AIConnect";alert.informativeText=message;NSApp.activate(ignoringOtherApps:true);alert.runModal()}
    @objc func quit(){NSApp.terminate(nil)}
    func userNotificationCenter(_ center:UNUserNotificationCenter,willPresent notification:UNNotification,withCompletionHandler completionHandler:@escaping(UNNotificationPresentationOptions)->Void){completionHandler([.banner,.list])}
    func userNotificationCenter(_ center:UNUserNotificationCenter,didReceive response:UNNotificationResponse,withCompletionHandler completionHandler:@escaping()->Void){
        let id=response.notification.request.content.userInfo["request_id"] as? String
        DispatchQueue.main.async {if let id=id,["approve","reject","cancel"].contains(response.actionIdentifier){self.confirmAction(id,response.actionIdentifier)}else{self.dashboard()}}
        completionHandler()
    }
}
let delegate=MenuApp()
NSApplication.shared.delegate=delegate
NSApplication.shared.run()
