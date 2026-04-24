import WidgetKit
import SwiftUI
import ExpoWidgets

// MARK: - Subviews

struct DrawingWidgetView: View {
    let url: String?
    let family: WidgetFamily
    
    var body: some View {
        ZStack {
            if let urlString = url, let imageUrl = URL(string: urlString), let data = try? Data(contentsOf: imageUrl), let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Color.gray.opacity(0.1)
                Text("No drawing yet")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            VStack {
                Spacer()
                HStack {
                    Text("Latest Drawing")
                        .font(.system(size: 10, weight: .bold))
                        .padding(4)
                        .background(.ultraThinMaterial)
                        .cornerRadius(4)
                    Spacer()
                }
                .padding(8)
            }
        }
    }
}

struct TouchWidgetView: View {
    let message: String?
    let timestamp: String?
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "hand.tap.fill")
                .font(.system(size: 30))
                .foregroundColor(.pink)
            
            Text(message ?? "Sent you a touch!")
                .font(.system(size: 14, weight: .medium))
                .multilineTextAlignment(.center)
            
            if let time = timestamp {
                Text(time)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
        }
        .containerBackground(.pink.opacity(0.1), for: .widget)
    }
}

struct DistanceWidgetView: View {
    let distance: String?
    let location: String?
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Distance")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.secondary)
            
            HStack(alignment: .bottom, spacing: 2) {
                Text(distance ?? "0")
                    .font(.system(size: 32, weight: .black))
                Text("km")
                    .font(.system(size: 14, weight: .bold))
                    .padding(.bottom, 6)
            }
            
            Spacer()
            
            HStack {
                Image(systemName: "location.fill")
                    .font(.system(size: 10))
                Text(location ?? "Unknown")
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundColor(.secondary)
        }
        .padding()
        .containerBackground(LinearGradient(colors: [.blue.opacity(0.1), .purple.opacity(0.1)], startPoint: .topLeading, endPoint: .bottomTrailing), for: .widget)
    }
}

struct MeetingWidgetView: View {
    let days: String?
    let title: String?
    
    var body: some View {
        VStack {
            Text(title ?? "Next Meeting")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.secondary)
            
            Spacer()
            
            Text(days ?? "0")
                .font(.system(size: 48, weight: .black))
                .foregroundColor(.orange)
            
            Text("DAYS LEFT")
                .font(.system(size: 10, weight: .black))
                .tracking(2)
            
            Spacer()
        }
        .padding()
        .containerBackground(.orange.opacity(0.05), for: .widget)
    }
}

struct RoutineWidgetView: View {
    let next: String?
    let time: String?
    let itemsJson: String?
    let family: WidgetFamily
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "clock.fill")
                Text("Routine")
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundColor(.indigo)
            
            if family == .systemSmall {
                Spacer()
                Text(next ?? "No activity")
                    .font(.system(size: 16, weight: .bold))
                Text(time ?? "--:--")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                Spacer()
            } else {
                Text("Next Up")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.secondary)
                
                Text("\(next ?? "None") at \(time ?? "--:--")")
                    .font(.system(size: 14, weight: .bold))
                
                Divider()
                
                // Placeholder for list if medium/large
                if family == .systemLarge {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(0..<4) { _ in
                            HStack {
                                Circle().fill(.indigo).frame(width: 6, height: 6)
                                Text("Upcoming Task...")
                                    .font(.system(size: 12))
                                Spacer()
                                Text("12:00")
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .padding()
        .containerBackground(.indigo.opacity(0.05), for: .widget)
    }
}

// MARK: - Main Entry View

struct TAMTAMWidgetEntryView : View {
    var entry: ExpoWidgetEntry<WidgetAttributes>
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch entry.attributes.type {
        case "drawing":
            DrawingWidgetView(url: entry.attributes.drawingUrl, family: family)
        case "touch":
            TouchWidgetView(message: entry.attributes.touchMessage, timestamp: entry.attributes.touchTimestamp)
        case "distance":
            DistanceWidgetView(distance: entry.attributes.distanceKm, location: entry.attributes.partnerLocationName)
        case "meeting":
            MeetingWidgetView(days: entry.attributes.daysUntilMeeting, title: entry.attributes.meetingTitle)
        case "routine":
            RoutineWidgetView(next: entry.attributes.nextActivity, time: entry.attributes.nextActivityTime, itemsJson: entry.attributes.routineItemsJson, family: family)
        default:
            VStack {
                Text("TAMTAM")
                    .font(.headline)
                Text("Select a widget type in app settings")
                    .font(.caption)
                    .multilineTextAlignment(.center)
            }
            .containerBackground(.fill.tertiary, for: .widget)
        }
    }
}

struct TAMTAMWidget: Widget {
    let kind: String = "TAMTAMWidget"

    var body: some WidgetConfiguration {
        ExpoWidgetConfiguration(kind: kind, attributes: WidgetAttributes.self) { entry in
            TAMTAMWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("TAMTAM")
        .description("Your shared world on your home screen.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
