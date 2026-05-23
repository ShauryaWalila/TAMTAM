// Native wrapper around UIKit's PKCanvasView (Apple PencilKit).
// Pure Objective-C — no Swift, no third-party deps. Built as a local CocoaPod
// (see PencilCanvas.podspec) so we control the entire pipeline.
//
// Exposes a single React Native view `PencilCanvasView` plus an attached
// view-manager with imperative methods:
//   clear / undo / redo / getBase64 / loadBase64 / getPng

#import <UIKit/UIKit.h>
#import <PencilKit/PencilKit.h>
#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>
#import <React/RCTComponent.h>

#pragma mark - View

API_AVAILABLE(ios(13.4))
@interface PencilCanvasView : UIView <PKCanvasViewDelegate>
@property (nonatomic, strong) PKCanvasView *canvas;
@property (nonatomic, copy) RCTDirectEventBlock onDrawingChange;
- (void)clearDrawing;
- (void)undoOp;
- (void)redoOp;
- (NSString *)getBase64String;
- (BOOL)loadBase64String:(NSString *)b64;
- (NSString *)getPngBase64:(CGFloat)scale;
@end

@implementation PencilCanvasView

- (instancetype)initWithFrame:(CGRect)frame {
  self = [super initWithFrame:frame];
  if (self && @available(iOS 13.4, *)) {
    _canvas = [[PKCanvasView alloc] initWithFrame:self.bounds];
    _canvas.delegate = self;
    _canvas.drawingPolicy = PKCanvasViewDrawingPolicyAnyInput;
    _canvas.backgroundColor = [UIColor clearColor];
    _canvas.opaque = NO;
    _canvas.tool = [[PKInkingTool alloc] initWithInkType:PKInkTypePen color:[UIColor blackColor] width:3.0];
    _canvas.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [self addSubview:_canvas];
  }
  return self;
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  if (@available(iOS 13.4, *)) {
    if (self.window != nil) {
      PKToolPicker *picker = [PKToolPicker sharedToolPickerForWindow:self.window];
      if (picker != nil) {
        [picker setVisible:YES forFirstResponder:_canvas];
        [picker addObserver:_canvas];
        [_canvas becomeFirstResponder];
      }
    } else {
      [_canvas resignFirstResponder];
    }
  }
}

- (void)canvasViewDrawingDidChange:(PKCanvasView *)canvasView API_AVAILABLE(ios(13.4)) {
  if (self.onDrawingChange) {
    self.onDrawingChange(@{});
  }
}

- (void)clearDrawing {
  if (@available(iOS 13.4, *)) {
    _canvas.drawing = [[PKDrawing alloc] init];
  }
}

- (void)undoOp { [_canvas.undoManager undo]; }
- (void)redoOp { [_canvas.undoManager redo]; }

- (NSString *)getBase64String {
  if (@available(iOS 13.4, *)) {
    NSData *data = [_canvas.drawing dataRepresentation];
    return [data base64EncodedStringWithOptions:0] ?: @"";
  }
  return @"";
}

- (BOOL)loadBase64String:(NSString *)b64 {
  if (@available(iOS 13.4, *)) {
    if (b64 == nil || b64.length == 0) return NO;
    NSData *data = [[NSData alloc] initWithBase64EncodedString:b64 options:NSDataBase64DecodingIgnoreUnknownCharacters];
    if (data == nil) return NO;
    NSError *err = nil;
    PKDrawing *drawing = [[PKDrawing alloc] initWithData:data error:&err];
    if (err != nil || drawing == nil) return NO;
    _canvas.drawing = drawing;
    return YES;
  }
  return NO;
}

- (NSString *)getPngBase64:(CGFloat)scale {
  if (@available(iOS 13.4, *)) {
    CGRect bounds = _canvas.bounds;
    if (CGRectIsEmpty(bounds)) return @"";
    CGFloat s = scale > 0 ? scale : 1.0;
    UIImage *img = [_canvas.drawing imageFromRect:bounds scale:s];
    NSData *png = UIImagePNGRepresentation(img);
    return [png base64EncodedStringWithOptions:0] ?: @"";
  }
  return @"";
}

@end

#pragma mark - Manager

@interface PencilCanvasViewManager : RCTViewManager
@end

@implementation PencilCanvasViewManager

// Use the default module name (== class name) so NativeModules.PencilCanvasViewManager
// is available in JS while requireNativeComponent('PencilCanvasView') auto-derives
// the component name by stripping "Manager".
RCT_EXPORT_MODULE()

- (UIView *)view {
  if (@available(iOS 13.4, *)) {
    return [[PencilCanvasView alloc] init];
  }
  return [[UIView alloc] init];
}

+ (BOOL)requiresMainQueueSetup { return YES; }

RCT_EXPORT_VIEW_PROPERTY(onDrawingChange, RCTDirectEventBlock)

#define WITH_VIEW(REACT_TAG, BODY) \
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *uiManager, NSDictionary<NSNumber *, UIView *> *viewRegistry) { \
    UIView *_v = viewRegistry[REACT_TAG]; \
    if (![_v isKindOfClass:[PencilCanvasView class]]) { return; } \
    PencilCanvasView *view = (PencilCanvasView *)_v; \
    BODY; \
  }]

RCT_EXPORT_METHOD(clear:(nonnull NSNumber *)reactTag) {
  WITH_VIEW(reactTag, [view clearDrawing]);
}

RCT_EXPORT_METHOD(undo:(nonnull NSNumber *)reactTag) {
  WITH_VIEW(reactTag, [view undoOp]);
}

RCT_EXPORT_METHOD(redo:(nonnull NSNumber *)reactTag) {
  WITH_VIEW(reactTag, [view redoOp]);
}

RCT_EXPORT_METHOD(getBase64:(nonnull NSNumber *)reactTag
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *uiManager, NSDictionary<NSNumber *, UIView *> *viewRegistry) {
    UIView *v = viewRegistry[reactTag];
    if (![v isKindOfClass:[PencilCanvasView class]]) { reject(@"PKC_NOT_FOUND", @"PencilCanvasView not found for tag", nil); return; }
    NSString *b64 = [(PencilCanvasView *)v getBase64String];
    resolve(b64 ?: @"");
  }];
}

RCT_EXPORT_METHOD(loadBase64:(nonnull NSNumber *)reactTag
                  data:(NSString *)data
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *uiManager, NSDictionary<NSNumber *, UIView *> *viewRegistry) {
    UIView *v = viewRegistry[reactTag];
    if (![v isKindOfClass:[PencilCanvasView class]]) { reject(@"PKC_NOT_FOUND", @"PencilCanvasView not found for tag", nil); return; }
    BOOL ok = [(PencilCanvasView *)v loadBase64String:data];
    resolve(@(ok));
  }];
}

RCT_EXPORT_METHOD(getPng:(nonnull NSNumber *)reactTag
                  scale:(double)scale
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *uiManager, NSDictionary<NSNumber *, UIView *> *viewRegistry) {
    UIView *v = viewRegistry[reactTag];
    if (![v isKindOfClass:[PencilCanvasView class]]) { reject(@"PKC_NOT_FOUND", @"PencilCanvasView not found for tag", nil); return; }
    NSString *b64 = [(PencilCanvasView *)v getPngBase64:(CGFloat)scale];
    resolve(b64 ?: @"");
  }];
}

@end
