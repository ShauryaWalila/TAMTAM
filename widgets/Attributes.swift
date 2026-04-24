import ExpoWidgets

struct WidgetAttributes: ExpoWidgetAttributes {
    // Shared common fields
    let type: String // "drawing", "touch", "distance", "meeting", "routine"
    
    // Drawing Data
    let drawingUrl: String?
    
    // Touch Data
    let touchMessage: String?
    let touchTimestamp: String?
    
    // Distance Data
    let distanceKm: String?
    let partnerLocationName: String?
    
    // Meeting Data
    let daysUntilMeeting: String?
    let meetingDate: String?
    let meetingTitle: String?
    
    // Routine Data
    // We'll pass routine as a JSON string and parse it in SwiftUI or use individual fields
    let nextActivity: String?
    let nextActivityTime: String?
    let routineItemsJson: String? // Simplified list for widget
}
