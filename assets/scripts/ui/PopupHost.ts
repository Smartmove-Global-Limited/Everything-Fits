// Opens a popup prefab (resources/ui/<Name>) on top of the current scene and returns its
// controller component. One instance per scene, reused on every open.
import { Node, director, instantiate, Component } from 'cc';
import { Overlays } from './Overlays';

export async function showPopup<T extends Component>(name: string, type: new () => T): Promise<T> {
  const canvas = director.getScene()!.getChildByName('Canvas')!;
  let n: Node | null = canvas.getChildByName(name);
  // added active so the controller's onLoad runs before open() (the caller opens it right away)
  if (!n) { n = instantiate(await Overlays.loadPrefab('ui/' + name)); n.name = name; canvas.addChild(n); }
  n.setSiblingIndex(canvas.children.length - 1);
  return n.getComponent(type) || n.addComponent(type);
}
