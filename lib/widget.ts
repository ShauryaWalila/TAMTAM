// Widgets stripped — free Apple Developer accounts cannot sign widget extensions
// when sideloading via SideStore. All widget exports are no-op stubs so existing
// callers keep compiling without pulling in @bittingz/expo-widgets.

export function updateDrawingWidget(_imageUrl: string) {}
export function updateTouchWidget(_message: string) {}
export function updateDistanceWidget(_km: string, _locationName: string) {}
export function updateMeetingWidget(_days: string, _title: string) {}
export function updateRoutineWidget(_next: string, _time: string, _items: any[] = []) {}
export function updateTamtamWidget(_message: string) {}
