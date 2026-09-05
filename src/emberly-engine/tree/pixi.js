import * as utils from '@pixi/utils';


import { BatchRenderer, extensions } from '@pixi/core';
import { WindowInteractionManager } from './WindowInteractionManager';
import '@pixi/canvas-display';
import { CanvasGraphicsRenderer } from '@pixi/canvas-graphics';
import { CanvasSpriteRenderer } from '@pixi/canvas-sprite';

export { utils };
export * from '@pixi/constants';
export * from '@pixi/math';
export * from '@pixi/settings';
export * from '@pixi/display';
export * from '@pixi/core';
export * from '@pixi/sprite';
export * from '@pixi/graphics';
export * from '@pixi/text';

extensions.add(BatchRenderer);
extensions.add(WindowInteractionManager);
extensions.add(CanvasGraphicsRenderer);
extensions.add(CanvasSpriteRenderer);

/*
yarn upgrade pixi.js@6.5.2 @pixi/core@6.5.2 @pixi/events@6.5.2 @pixi/extract@6.5.2 @pixi/canvas-text@6.5.2 @pixi/canvas-extract@6.5.2 @pixi/canvas-renderer@6.5.2 @pixi/ticker@6.5.2 @pixi/utils@6.5.2 @pixi/interaction@6.5.2 @pixi/canvas-display@6.5.2 @pixi/canvas-graphics@6.5.2 @pixi/canvas-sprite@6.5.2 @pixi/constants@6.5.2 @pixi/math@6.5.2 @pixi/settings@6.5.2 @pixi/display@6.5.2 @pixi/core@6.5.2 @pixi/sprite@6.5.2 @pixi/graphics@6.5.2 @pixi/text@6.5.2
*/

