'use strict';
const axios = require('axios');

// 定义评估模板
const TEMPLATES = {
    basic: {
	  "wrong vocabularies": {
		"corrected-vocab": {
		  "wrong_word1": "correct_word1",
		  "wrong_word2": "correct_word2"
		},
		"detail-vocab": {
		  "wrong_word1": "explanation1",
		  "wrong_word2": "explanation2"
		}
	  },
	  "wrong grammar": {
		"corrected-grammar": {
		  "wrong_phrase1": "correct_phrase1",
		  "wrong_phrase2": "correct_phrase2"
		},
		"detail-grammar": {
		  "wrong_phrase1": "explanation1",
		  "wrong_phrase2": "explanation2"
		}
	  }
    },
    deep: {
        "Task Response": {"score": 0, "detail": ""},
        "Coherence and Cohesion": {"score": 0, "detail": ""},
        "Lexical Resources": {"score": 0, "detail": ""},
        "Grammatical Range and Accuracy": {"score": 0, "detail": ""},
        "Summary": {"score": 0, "detail": ""}
    }
};

exports.main = async (event, context) => {
    // 只保留 basic 和 deep 类型，取消 full
    const { topicContent, inputText, type = 'deep' } = event;
    
    // 根据类型选择评估模板
    const template = type === 'basic' ? TEMPLATES.basic : TEMPLATES.deep;

    // 拼接形式构建 content，basic 用 prompt_basic，deep 用 prompt_deep
    let prefix = '';
    if (type === 'basic') {
        prefix = `Answer: ${inputText}`;
    } else {
        prefix = `Question: ${topicContent.english}\nAnswer: ${inputText}`;
    }
    const prompt_basic = `理解并评估文本，根据以下JSON模板格式返回内容：
        ${JSON.stringify(template, null, 4)}

        Important:
        1. 给出错误的和正确的英文版本均包含前后2字方便上下文定位，并填入"corrected-vocab"或 "corrected-grammar" 字段；
        2. 对于每个error，在 "detail-vocab" 或 "detail-grammar" 字段中给出具体的中文解释，加以鼓励语气
        3. 确保所有错误都得到纠正，并且解释要全面；如果无错误，返回空JSON对象{}
       
        `; 
    const prompt_deep = `理解并评估文本，根据以下JSON模板格式返回内容:
        ${JSON.stringify(template, null, 4)}
        \n 1. 给出专业准确的雅思评分，分值0-9，最小分段0.5
		   2. 使用中文给出 "detail" 内容，加以鼓励语气
		
        `;
    const content = type === 'basic' ? `${prefix}\n${prompt_basic}` : `${prefix}\n${prompt_deep}`;
    
    const options = {
        method: 'POST',
        url: 'https://api.siliconflow.cn/v1/chat/completions',
        headers: { 
            Authorization: 'Bearer sk-nmzpenmkkzgqhxecgbqpnrgoppafxgguaxzfgnmmmawdtisa', 
            'Content-Type': 'application/json' 
        },
        data: {
            model: 'Qwen/Qwen3-30B-A3B', //备选：Qwen/Qwen3-8B(拥挤) , Qwen/Qwen3-30B-A3B , deepseek-ai/DeepSeek-R1-0528-Qwen3-8B , Pro/deepseek-ai/DeepSeek-V3.2-Exp
            stream: false,
            max_tokens: 8192,
            enable_thinking: false,
            thinking_budget: 10000,
            min_p: 0.05,
            temperature: 1,
            top_p: 0.8,
            top_k: 10,
            frequency_penalty: 0.0,
            n: 1,
            stop: [],
            messages: [
                {
                    role: "user",
                    content
                }
            ]
        }
    };

    try {
        const response = await axios(options);
        const content = response.data.choices[0].message.content;
        console.log('千问大模型API调用结果:', content);

        // 提取JSON部分
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('无法从响应中提取JSON数据');
        }
        
        let sanitizedContent = (jsonMatch[1] || jsonMatch[0])
            .replace(/"([^"]*)" \(([^)]*)\)/g, '"$1 (should be $2)"')
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"');

        const evaluationData = JSON.parse(sanitizedContent);
        
        // 构建返回结果
        const evaluation = {};
        
        // 如果是basic类型，添加词汇和语法评估
        if (type === 'basic') {
            evaluation.wrongVocabularies = {
                'detail-vocab': evaluationData['wrong vocabularies']?.['detail-vocab'] || {},
                'corrected-vocab': evaluationData['wrong vocabularies']?.['corrected-vocab'] || {},
            };
            evaluation.wrongGrammar = {
                'detail-grammar': evaluationData['wrong grammar']?.['detail-grammar'] || {},
                'corrected-grammar': evaluationData['wrong grammar']?.['corrected-grammar'] || {}
            };
        }
        // 如果是deep类型，添加深度评估
        if (type === 'deep') {
            evaluation.taskResponse = {
                score: evaluationData['Task Response']?.['score'] || 0,
                detail: evaluationData['Task Response']?.detail || ''
            };
            evaluation.coherenceAndCohesion = {
                score: evaluationData['Coherence and Cohesion']?.['score'] || 0,
                detail: evaluationData['Coherence and Cohesion']?.detail || ''
            };
            evaluation.lexicalResources = {
                score: evaluationData['Lexical Resources']?.['score'] || 0,
                detail: evaluationData['Lexical Resources']?.detail || ''
            };
            evaluation.grammaticalRangeAndAccuracy = {
                score: evaluationData['Grammatical Range and Accuracy']?.['score'] || 0,
                detail: evaluationData['Grammatical Range and Accuracy']?.detail || ''
            };
            evaluation.summary = 
			{
			    score: evaluationData['Summary']?.['score'] || 0,
			    detail: evaluationData['Summary']?.detail || ''
			};
        }

			return { evaluation };

    } catch (err) {
        console.error('千问大模型API调用失败:', err);
        return {
            evaluation: type === 'basic' ? { ...TEMPLATES.basic } : { ...TEMPLATES.deep },
            error: 'API调用失败',
            details: err.message
        };
    }
};