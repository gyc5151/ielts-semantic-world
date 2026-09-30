# 中文辅助翻译层与模型署名

`wordnet-zh-s01.json` 保存项目中文辅助层，不覆盖WordNet原英文。78个重点义项与45条原例句使用项目译解；其余通过本地机器翻译生成，逐条标为 `machine`，未逐条人工校订。机器译文可能不自然或错译，不是权威词典官方中文，也没有被批准为学习目标。

使用Argos官方模型索引中的 `translate-en_zh-1_9`，元数据注明English → Chinese、package 1.9。模型包README标注：由OPUS模型派生，原模型许可为CC-BY 4.0。署名：Jörg Tiedemann、Santhosh Thottingal，*OPUS-MT — Building open translation services for the World*，EAMT 2020，Lisbon, Portugal。

来源：[Argos Translate](https://www.argosopentech.com/)；[模型索引](https://github.com/argosopentech/argospm-index)；[模型包](https://argos-net.com/v1/translate-en_zh-1_9.argosmodel)；[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)。推理由本地CTranslate2与SentencePiece完成。网页只加载预生成JSON，没有连接远程翻译服务；学习答案没有用于模型翻译。

复现脚本 `prototype/scripts/build_dictionary_translations.py` 使用独立环境中的CTranslate2/SentencePiece；传入模型解压目录。`wordnet-definition-translations-s01.json` 与 `wordnet-translations-s01.json` 保留项目译解并优先覆盖机器草稿。原始English键与义项ID均可追溯到WordNet，原始WordNet许可另见 `WORDNET_LICENSE.txt`。

`data/s01-text-translations.json` 是本项目为9站45题编写的中文层；它不使用上述机器草稿作为教学译文。场景原英文继续保存在各 `s01-mXX.json` 中。
